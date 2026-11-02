// Lokal's icon handler for Explorer (Settings > File Icons > Covers in Details
// and List): an audio file's icon is its own cover where it has one, in
// every view -- Details, List and Small icons draw icons only, never
// thumbnails. Files without a cover get the icon set's one.
//
// Explorer loads this DLL (registered for Lokal's file types by
// electron/ipc/fileIcons.js: DefaultIcon "%1", ShellEx\IconHandler) and asks
// it, file by file, through IPersistFile::Load and IExtractIconW. The cover
// isn't read here: Windows' own thumbnail of the file is asked for
// (IShellItemImageFactory, thumbnails only -- its thumbnail handler, not this
// icon handler, so no loop) and drawn into an icon. The fallback is the
// ProgID's LokalFallbackIcon value ("<file>",<index>), what DefaultIcon held.
//
// It runs inside Explorer: every call catches everything and fails softly
// (Explorer then draws its default icon); no threads, no state but the
// object counts.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <shlwapi.h>
#include <shellapi.h>
#include <strsafe.h>
#include <new>
#include <string>
#include <vector>

// {7B3E2C91-5A4D-4F6B-9E1A-6C2D8F0B3A57}
static const CLSID CLSID_LokalIconHandler = { 0x7b3e2c91, 0x5a4d, 0x4f6b, { 0x9e, 0x1a, 0x6c, 0x2d, 0x8f, 0x0b, 0x3a, 0x57 } };

static long g_objects = 0;
static long g_locks = 0;

namespace {

// The cover as an icon `size` px square: the thumbnail centred, its own shape kept.
HICON CoverIcon(const std::wstring& path, int size) {
  if (size <= 0 || size > 1024) return nullptr;
  IShellItemImageFactory* factory = nullptr;
  if (FAILED(SHCreateItemFromParsingName(path.c_str(), nullptr, IID_PPV_ARGS(&factory)))) return nullptr;
  HBITMAP thumb = nullptr;
  SIZE want = { size, size };
  HRESULT hr = factory->GetImage(want, SIIGBF_THUMBNAILONLY, &thumb);
  factory->Release();
  if (FAILED(hr) || !thumb) return nullptr;

  BITMAP info = {};
  GetObjectW(thumb, sizeof(info), &info);
  const int w = info.bmWidth, h = info.bmHeight;
  HICON icon = nullptr;
  if (w > 0 && h > 0 && w <= size && h <= size) {
    std::vector<DWORD> src(static_cast<size_t>(w) * h);
    BITMAPINFO bi = {};
    bi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bi.bmiHeader.biWidth = w;
    bi.bmiHeader.biHeight = -h;  // top-down
    bi.bmiHeader.biPlanes = 1;
    bi.bmiHeader.biBitCount = 32;
    bi.bmiHeader.biCompression = BI_RGB;
    HDC screen = GetDC(nullptr);
    const int lines = GetDIBits(screen, thumb, 0, h, src.data(), &bi, DIB_RGB_COLORS);
    ReleaseDC(nullptr, screen);
    if (lines == h) {
      // A picture without alpha (all 0) is opaque.
      bool anyAlpha = false;
      for (DWORD px : src) if (px >> 24) { anyAlpha = true; break; }

      BITMAPINFO out = bi;
      out.bmiHeader.biWidth = size;
      out.bmiHeader.biHeight = -size;
      void* bits = nullptr;
      HBITMAP color = CreateDIBSection(nullptr, &out, DIB_RGB_COLORS, &bits, nullptr, 0);
      if (color && bits) {
        DWORD* dst = static_cast<DWORD*>(bits);
        ZeroMemory(dst, static_cast<size_t>(size) * size * 4);
        const int left = (size - w) / 2, top = (size - h) / 2;
        for (int y = 0; y < h; ++y) {
          for (int x = 0; x < w; ++x) {
            DWORD px = src[static_cast<size_t>(y) * w + x];
            if (!anyAlpha) px |= 0xff000000;
            dst[static_cast<size_t>(top + y) * size + left + x] = px;
          }
        }
        std::vector<BYTE> zeros(static_cast<size_t>((size + 15) / 16) * 2 * size, 0);
        HBITMAP mask = CreateBitmap(size, size, 1, 1, zeros.data());
        if (mask) {
          ICONINFO ii = {};
          ii.fIcon = TRUE;
          ii.hbmColor = color;
          ii.hbmMask = mask;
          icon = CreateIconIndirect(&ii);
          DeleteObject(mask);
        }
      }
      if (color) DeleteObject(color);
    }
  }
  DeleteObject(thumb);
  return icon;
}

// "C:\...\pack.dll",5 -> file, index.
bool ParseLocation(const std::wstring& text, std::wstring& file, int& index) {
  std::wstring value = text;
  size_t comma = value.rfind(L',');
  index = 0;
  if (comma != std::wstring::npos) {
    index = _wtoi(value.c_str() + comma + 1);
    value = value.substr(0, comma);
  }
  while (!value.empty() && (value.front() == L'"' || value.front() == L' ')) value.erase(value.begin());
  while (!value.empty() && (value.back() == L'"' || value.back() == L' ')) value.pop_back();
  file = value;
  return !file.empty();
}

// The set's icon for this type: HKCU\Software\Classes\Lokal.Audio.<ext> LokalFallbackIcon.
bool FallbackLocation(const std::wstring& path, std::wstring& file, int& index) {
  const wchar_t* ext = PathFindExtensionW(path.c_str());
  if (!ext || !*ext) return false;
  std::wstring key = L"Software\\Classes\\Lokal.Audio." + std::wstring(ext + 1);
  wchar_t value[MAX_PATH * 2] = {};
  DWORD bytes = sizeof(value) - sizeof(wchar_t);
  if (RegGetValueW(HKEY_CURRENT_USER, key.c_str(), L"LokalFallbackIcon", RRF_RT_REG_SZ, nullptr, value, &bytes) != ERROR_SUCCESS) return false;
  return ParseLocation(value, file, index);
}

class IconHandler final : public IExtractIconW, public IPersistFile {
 public:
  IconHandler() { InterlockedIncrement(&g_objects); }
  ~IconHandler() { InterlockedDecrement(&g_objects); }

  // IUnknown
  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    *ppv = nullptr;
    if (riid == IID_IUnknown || riid == IID_IExtractIconW) *ppv = static_cast<IExtractIconW*>(this);
    else if (riid == IID_IPersistFile || riid == IID_IPersist) *ppv = static_cast<IPersistFile*>(this);
    else return E_NOINTERFACE;
    AddRef();
    return S_OK;
  }
  IFACEMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&refs_); }
  IFACEMETHODIMP_(ULONG) Release() override {
    const long left = InterlockedDecrement(&refs_);
    if (!left) delete this;
    return left;
  }

  // IPersistFile: the file the icon is for.
  IFACEMETHODIMP GetClassID(CLSID* clsid) override { if (!clsid) return E_POINTER; *clsid = CLSID_LokalIconHandler; return S_OK; }
  IFACEMETHODIMP IsDirty() override { return S_FALSE; }
  IFACEMETHODIMP Load(LPCOLESTR file, DWORD) override {
    try { path_ = file ? file : L""; return path_.empty() ? E_INVALIDARG : S_OK; } catch (...) { return E_FAIL; }
  }
  IFACEMETHODIMP Save(LPCOLESTR, BOOL) override { return E_NOTIMPL; }
  IFACEMETHODIMP SaveCompleted(LPCOLESTR) override { return E_NOTIMPL; }
  IFACEMETHODIMP GetCurFile(LPOLESTR*) override { return E_NOTIMPL; }

  // IExtractIconW: one icon a file (per instance), drawn by Extract.
  IFACEMETHODIMP GetIconLocation(UINT, PWSTR file, UINT cch, int* index, UINT* flags) override {
    try {
      if (!file || !index || !flags || path_.empty() || cch < 2) return E_INVALIDARG;
      if (FAILED(StringCchCopyW(file, cch, path_.c_str()))) return E_FAIL;
      *index = 0;
      *flags = GIL_NOTFILENAME | GIL_PERINSTANCE;
      return S_OK;
    } catch (...) { return E_FAIL; }
  }

  IFACEMETHODIMP Extract(PCWSTR, UINT, HICON* largeIcon, HICON* smallIcon, UINT sizes) override {
    try {
      const int largeSize = LOWORD(sizes), smallSize = HIWORD(sizes);
      HICON big = largeIcon ? CoverIcon(path_, largeSize) : nullptr;
      HICON little = smallIcon ? CoverIcon(path_, smallSize) : nullptr;
      if ((largeIcon && !big) || (smallIcon && !little)) {
        if (big) DestroyIcon(big);
        if (little) DestroyIcon(little);
        big = little = nullptr;
        std::wstring file;
        int index = 0;
        if (!FallbackLocation(path_, file, index)) return S_FALSE;
        if (FAILED(SHDefExtractIconW(file.c_str(), index, 0, largeIcon ? &big : nullptr, smallIcon ? &little : nullptr, sizes))) return S_FALSE;
      }
      if (largeIcon) *largeIcon = big;
      if (smallIcon) *smallIcon = little;
      return S_OK;
    } catch (...) { return E_FAIL; }
  }

 private:
  long refs_ = 1;
  std::wstring path_;
};

class Factory final : public IClassFactory {
 public:
  Factory() { InterlockedIncrement(&g_objects); }
  ~Factory() { InterlockedDecrement(&g_objects); }
  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    *ppv = nullptr;
    if (riid == IID_IUnknown || riid == IID_IClassFactory) { *ppv = static_cast<IClassFactory*>(this); AddRef(); return S_OK; }
    return E_NOINTERFACE;
  }
  IFACEMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&refs_); }
  IFACEMETHODIMP_(ULONG) Release() override {
    const long left = InterlockedDecrement(&refs_);
    if (!left) delete this;
    return left;
  }
  IFACEMETHODIMP CreateInstance(IUnknown* outer, REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    *ppv = nullptr;
    if (outer) return CLASS_E_NOAGGREGATION;
    IconHandler* handler = new (std::nothrow) IconHandler();
    if (!handler) return E_OUTOFMEMORY;
    const HRESULT hr = handler->QueryInterface(riid, ppv);
    handler->Release();
    return hr;
  }
  IFACEMETHODIMP LockServer(BOOL lock) override {
    if (lock) InterlockedIncrement(&g_locks); else InterlockedDecrement(&g_locks);
    return S_OK;
  }

 private:
  long refs_ = 1;
};

}  // namespace

STDAPI DllGetClassObject(REFCLSID clsid, REFIID riid, void** ppv) {
  if (!ppv) return E_POINTER;
  *ppv = nullptr;
  if (clsid != CLSID_LokalIconHandler) return CLASS_E_CLASSNOTAVAILABLE;
  Factory* factory = new (std::nothrow) Factory();
  if (!factory) return E_OUTOFMEMORY;
  const HRESULT hr = factory->QueryInterface(riid, ppv);
  factory->Release();
  return hr;
}

STDAPI DllCanUnloadNow() {
  return g_objects == 0 && g_locks == 0 ? S_OK : S_FALSE;
}
