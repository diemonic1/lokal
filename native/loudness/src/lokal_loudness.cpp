// See lokal_loudness.h. Nothing here may depend on the platform: integer
// decoding, plain IEEE double arithmetic in a fixed order, no libm. Built with
// FMA contraction off (-ffp-contract=off; MSVC doesn't contract by default).
#include "lokal_loudness.h"

#include <stdlib.h>
#include <string.h>

#include "pvmp3decoder_api.h"

#if defined(_MSC_VER)
#define LL_SEEK _fseeki64
#define LL_TELL _ftelli64
#else
#define LL_SEEK fseeko
#define LL_TELL ftello
#endif

namespace {

// ---------------------------------------------------------------- arithmetic

const double LN2 = 0.6931471805599453;
const double LN10 = 2.302585092994046;
const double SQRT1_2 = 0.7071067811865476;

/** log10(x) for x > 0 from + - * / alone, so every platform gets the same bits. */
double log10_exact(double x) {
  // x = m * 2^e with m in [sqrt(1/2), sqrt(2)): scaling by 2 is exact.
  int e = 0;
  while (x >= 2.0) { x *= 0.5; e++; }
  while (x < 1.0) { x *= 2.0; e--; }
  if (x > 2.0 * SQRT1_2) { x *= 0.5; e++; }
  // ln(m) = 2 atanh(s), s = (m - 1) / (m + 1), |s| < 0.172: 15 terms reach 1e-17.
  double s = (x - 1.0) / (x + 1.0);
  double s2 = s * s;
  double term = s;
  double sum = 0.0;
  for (int k = 1; k <= 29; k += 2) {
    sum += term / k;
    term *= s2;
  }
  return (2.0 * sum + e * LN2) / LN10;
}

/** BS.1770's K-weighting (high shelf, then high pass), libebur128's coefficients, per MP3 sample rate. */
struct KCoefs { int32_t rate; double b0, b1, b2, a1, a2, d1, d2; };
const KCoefs K_COEFS[] = {
    {8000, 1.3216235689299776, -0.7262554913156911, 0.2981262460162007, -0.2933807824149212, 0.18687510604540827, -1.9410133428292178, 0.9418843041685022},
    {11025, 1.3865361929457163, -1.311513919936862, 0.46380830843465626, -0.7281015380211461, 0.2669321194646565, -1.9570257313221775, 0.9574880195018185},
    {12000, 1.4010163859611828, -1.443431419640203, 0.5127251913609369, -0.82398044060334, 0.2942905982852567, -1.9604831799520142, 0.9608740755235704},
    {16000, 1.4432952234913587, -1.8315753812604594, 0.6816587574119699, -1.1015337691069944, 0.39491236874986363, -1.9702895280044335, 0.9705104905358434},
    {22050, 1.4798253509777464, -2.1707286128568293, 0.8608424847265516, -1.3383053360661337, 0.5082445589136019, -1.9783976025901193, 0.9785144195032509},
    {24000, 1.4879002209622763, -2.2462054681411368, 0.904909123246438, -1.3902346051928203, 0.5368384812603979, -1.9801441262289323, 0.9802428178592764},
    {32000, 1.5111778995687646, -2.464889413360141, 1.0416332735222955, -1.5390450962506403, 0.626966855981559, -1.9850896689886883, 0.9851453206695515},
    {44100, 1.5308412300503478, -2.6509799951547297, 1.169079079921587, -1.6636551132560204, 0.7125954280732254, -1.989169673629796, 0.9891990357870393},
    {48000, 1.5351248595869702, -2.6916961894063807, 1.19839281085285, -1.6906592931824103, 0.7324807742158501, -1.9900474548339797, 0.9900722503662099},
};

/** -70 LUFS as mean square energy: 10^((-70 + 0.691) / 10). */
const double ABS_GATE = 1.1724653045822981e-07;

struct KFilter {
  double s1 = 0, s2 = 0, t1 = 0, t2 = 0;
  double process(const KCoefs &k, double x) {
    double y = k.b0 * x + s1;
    s1 = k.b1 * x - k.a1 * y + s2;
    s2 = k.b2 * x - k.a2 * y;
    double z = y + t1;
    t1 = -2.0 * y - k.d1 * z + t2;
    t2 = y - k.d2 * z;
    return z;
  }
};

class Meter {
 public:
  bool init(int32_t rate, int32_t channels) {
    for (const KCoefs &k : K_COEFS) if (k.rate == rate) coefs_ = &k;
    if (!coefs_ || channels < 1 || channels > 2) return false;
    rate_ = rate;
    channels_ = channels;
    sub_frames_ = rate / 10;
    return true;
  }
  bool ready() const { return coefs_ != nullptr; }
  int32_t rate() const { return rate_; }
  int32_t channels() const { return channels_; }
  int64_t frames() const { return frames_; }

  /** Interleaved samples, `n` frames of them. */
  bool add(const int16_t *pcm, int64_t n) {
    for (int64_t i = 0; i < n; i++) {
      for (int32_t c = 0; c < channels_; c++) {
        int32_t v = pcm[i * channels_ + c];
        int32_t a = v < 0 ? -v : v;
        if (a > peak_) peak_ = a;
        double y = filters_[c].process(*coefs_, v / 32768.0);
        sub_sum_ += y * y;
      }
      frames_++;
      if (++sub_count_ == sub_frames_) {
        if (subs_n_ == subs_cap_) {
          size_t cap = subs_cap_ ? subs_cap_ * 2 : 1024;
          double *grown = static_cast<double *>(realloc(subs_, cap * sizeof(double)));
          if (!grown) return false;
          subs_ = grown;
          subs_cap_ = cap;
        }
        subs_[subs_n_++] = sub_sum_ / sub_frames_;
        sub_sum_ = 0;
        sub_count_ = 0;
      }
    }
    return true;
  }

  void finish(lokal_loudness_result &r) const {
    r.sample_rate = rate_;
    r.channels = channels_;
    r.frames = frames_;
    r.peak_micro = static_cast<int32_t>((static_cast<int64_t>(peak_) * 1000000 + 16384) / 32768);
    // 400 ms blocks every 100 ms; the mean of the blocks above each gate.
    double sum = 0;
    int64_t n = 0;
    for (size_t i = 0; i + 3 < subs_n_; i++) {
      double b = (subs_[i] + subs_[i + 1] + subs_[i + 2] + subs_[i + 3]) / 4;
      if (b > ABS_GATE) { sum += b; n++; }
    }
    if (n == 0) { r.status = LOKAL_LOUDNESS_SILENT; return; }
    double rel_gate = sum / n / 10;  // 10 LU below the mean
    sum = 0;
    n = 0;
    for (size_t i = 0; i + 3 < subs_n_; i++) {
      double b = (subs_[i] + subs_[i + 1] + subs_[i + 2] + subs_[i + 3]) / 4;
      if (b > ABS_GATE && b > rel_gate) { sum += b; n++; }
    }
    double lufs = -0.691 + 10 * log10_exact(sum / n);
    double tenths = lufs * 10 + 0.5;
    int32_t t = static_cast<int32_t>(tenths);
    if (t > tenths) t--;  // floor
    r.lufs_tenths = t;
    r.status = LOKAL_LOUDNESS_OK;
  }

  ~Meter() { free(subs_); }

 private:
  const KCoefs *coefs_ = nullptr;
  int32_t rate_ = 0, channels_ = 0, sub_frames_ = 0, sub_count_ = 0;
  int32_t peak_ = 0;
  int64_t frames_ = 0;
  double sub_sum_ = 0;
  double *subs_ = nullptr;
  size_t subs_n_ = 0, subs_cap_ = 0;
  KFilter filters_[2];
};

// ---------------------------------------------------------------- reading

/** A window over the file between `pos` and `end`, refilled as it's read. */
class Reader {
 public:
  Reader(FILE *f, int64_t start, int64_t end) : f_(f), pos_(start), end_(end) {}
  ~Reader() { free(buf_); }

  bool open() {
    // Zeroed, with room past the end: the decoder may read a few bytes beyond a frame.
    buf_ = static_cast<uint8_t *>(calloc(1, CAP + 64));
    return buf_ && LL_SEEK(f_, pos_, SEEK_SET) == 0;
  }

  /** At least `n` bytes from the current position in the window, or as many as are left. -> how many. */
  size_t ensure(size_t n) {
    if (len_ - off_ >= n) return n;
    memmove(buf_, buf_ + off_, len_ - off_);
    len_ -= off_;
    off_ = 0;
    int64_t file_pos = pos_ + static_cast<int64_t>(len_);
    int64_t left = end_ - file_pos;
    size_t want = CAP - len_;
    if (left < static_cast<int64_t>(want)) want = left > 0 ? static_cast<size_t>(left) : 0;
    if (want > 0) {
      size_t got = fread(buf_ + len_, 1, want, f_);
      if (got < want) {
        error_ = ferror(f_) != 0;
        end_ = file_pos + static_cast<int64_t>(got);
      }
      len_ += got;
    }
    return len_ - off_ < n ? len_ - off_ : n;
  }
  uint8_t *data() { return buf_ + off_; }
  void skip(size_t n) { off_ += n; pos_ += static_cast<int64_t>(n); }
  int64_t pos() const { return pos_; }
  int64_t end() const { return end_; }
  bool error() const { return error_; }

 private:
  static const size_t CAP = 1 << 18;
  FILE *f_;
  int64_t pos_, end_;
  uint8_t *buf_ = nullptr;
  size_t len_ = 0, off_ = 0;
  bool error_ = false;
};

struct Header { uint32_t key; int32_t size; };

/** An MPEG audio layer III frame header -> its size; false otherwise. `key` holds what every frame of a stream shares. */
bool parse_header(const uint8_t *p, Header &h) {
  uint32_t v = (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3];
  if ((v & 0xFFE00000u) != 0xFFE00000u) return false;
  uint32_t version = (v >> 19) & 3, layer = (v >> 17) & 3;
  uint32_t bitrate_index = (v >> 12) & 15, rate_index = (v >> 10) & 3, padding = (v >> 9) & 1;
  if (version == 1 || layer != 1 || bitrate_index == 0 || bitrate_index == 15 || rate_index == 3) return false;
  static const int32_t RATES[] = {44100, 48000, 32000};
  static const int32_t V1[] = {32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320};
  static const int32_t V2[] = {8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160};
  int32_t rate = RATES[rate_index] >> (version == 3 ? 0 : version == 2 ? 1 : 2);
  int32_t kbps = version == 3 ? V1[bitrate_index - 1] : V2[bitrate_index - 1];
  h.size = (version == 3 ? 144000 : 72000) * kbps / rate + static_cast<int32_t>(padding);
  h.key = v & 0xFFFE0C00u;  // sync, version, layer, sample rate
  return true;
}

uint32_t synchsafe(const uint8_t *p) {
  return (uint32_t)(p[0] & 0x7F) << 21 | (uint32_t)(p[1] & 0x7F) << 14 | (uint32_t)(p[2] & 0x7F) << 7 | (p[3] & 0x7F);
}

/** Where the audio ends: before an ID3v1 tag and an APEv2 tag at the end of the file. */
int64_t audio_end(FILE *f, int64_t size) {
  uint8_t b[32];
  int64_t end = size;
  if (end >= 128 && LL_SEEK(f, end - 128, SEEK_SET) == 0 && fread(b, 1, 3, f) == 3 && memcmp(b, "TAG", 3) == 0) end -= 128;
  if (end >= 32 && LL_SEEK(f, end - 32, SEEK_SET) == 0 && fread(b, 1, 32, f) == 32 && memcmp(b, "APETAGEX", 8) == 0) {
    uint32_t tag = (uint32_t)b[12] | (uint32_t)b[13] << 8 | (uint32_t)b[14] << 16 | (uint32_t)b[15] << 24;
    bool has_header = (b[23] & 0x80) != 0;
    int64_t cut = static_cast<int64_t>(tag) + (has_header ? 32 : 0);
    if (cut <= end) end -= cut;
  }
  return end;
}

/** Past the ID3v2 tag(s) at the start. */
int64_t audio_start(FILE *f, int64_t end) {
  int64_t pos = 0;
  uint8_t b[10];
  while (pos + 10 <= end && LL_SEEK(f, pos, SEEK_SET) == 0 && fread(b, 1, 10, f) == 10 && memcmp(b, "ID3", 3) == 0) {
    pos += 10 + synchsafe(b + 6) + ((b[5] & 0x10) ? 10 : 0);
  }
  return pos < end ? pos : end;
}

}  // namespace

extern "C" lokal_loudness_result lokal_loudness_measure(FILE *file, int32_t max_seconds,
                                                        int (*cancelled)(void *), void *user) {
  lokal_loudness_result r;
  memset(&r, 0, sizeof r);
  if (LL_SEEK(file, 0, SEEK_END) != 0) { r.status = LOKAL_LOUDNESS_READ_ERROR; return r; }
  int64_t size = LL_TELL(file);
  if (size < 0) { r.status = LOKAL_LOUDNESS_READ_ERROR; return r; }
  int64_t end = audio_end(file, size);
  int64_t start = audio_start(file, end);

  Reader in(file, start, end);
  tPVMP3DecoderExternal ext;
  memset(&ext, 0, sizeof ext);
  void *mem = calloc(1, pvmp3_decoderMemRequirements());
  int16_t *pcm = static_cast<int16_t *>(malloc(4608 * 2 * sizeof(int16_t)));
  if (!mem || !pcm || !in.open()) {
    free(mem); free(pcm);
    r.status = LOKAL_LOUDNESS_NO_MEMORY;
    return r;
  }
  pvmp3_InitDecoder(&ext, mem);
  ext.equalizerType = flat;
  ext.crcEnabled = 0;

  Meter meter;
  int64_t max_frames = -1;
  uint32_t key = 0;
  bool synced = false;
  int32_t count = 0;
  int32_t status = LOKAL_LOUDNESS_OK;

  for (;;) {
    if (cancelled && (++count & 31) == 0 && cancelled(user)) { status = LOKAL_LOUDNESS_CANCELLED; break; }
    if (max_frames >= 0 && meter.frames() >= max_frames) break;
    if (in.ensure(4) < 4) break;
    Header h;
    if (!parse_header(in.data(), h) || (synced && h.key != key)) {
      // Lost: look for the next frame, one byte on.
      synced = false;
      in.skip(1);
      continue;
    }
    if (!synced) {
      // A frame found by searching counts when the next one follows it (or the file ends there).
      size_t need = static_cast<size_t>(h.size) + 4;
      Header next;
      size_t got = in.ensure(need);
      bool last = in.pos() + h.size >= in.end();
      if (!last && (got < need || !parse_header(in.data() + h.size, next) || next.key != h.key)) {
        in.skip(1);
        continue;
      }
      synced = true;
      key = h.key;
    }
    if (in.ensure(static_cast<size_t>(h.size)) < static_cast<size_t>(h.size)) break;  // cut short at the end

    ext.pInputBuffer = in.data();
    ext.inputBufferCurrentLength = h.size;
    ext.inputBufferUsedLength = 0;
    ext.inputBufferMaxLength = 0;
    ext.pOutputBuffer = pcm;
    ext.outputFrameSize = 4608 * 2;
    ERROR_CODE err = pvmp3_framedecoder(&ext, mem);
    in.skip(static_cast<size_t>(h.size));
    if (err != NO_DECODING_ERROR || ext.num_channels < 1) continue;  // e.g. the first frames' missing bit reservoir

    if (!meter.ready()) {
      if (!meter.init(ext.samplingRate, ext.num_channels)) { status = LOKAL_LOUDNESS_NOT_MP3; break; }
      max_frames = static_cast<int64_t>(meter.rate()) * max_seconds;
    }
    if (ext.samplingRate != meter.rate() || ext.num_channels != meter.channels()) continue;
    int64_t n = ext.outputFrameSize / ext.num_channels;
    if (meter.frames() + n > max_frames) n = max_frames - meter.frames();
    if (!meter.add(pcm, n)) { status = LOKAL_LOUDNESS_NO_MEMORY; break; }
  }

  if (status == LOKAL_LOUDNESS_OK) {
    if (in.error()) status = LOKAL_LOUDNESS_READ_ERROR;
    else if (!meter.ready()) status = LOKAL_LOUDNESS_NOT_MP3;
  }
  if (status == LOKAL_LOUDNESS_OK) meter.finish(r);
  else r.status = status;
  free(mem);
  free(pcm);
  return r;
}
