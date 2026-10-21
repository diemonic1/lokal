// measure(path, maxSeconds) -> Promise<{ status, lufsTenths, peakMicro, sampleRate, channels, frames }>
// Lokal's loudness measurement (src/lokal_loudness.h) on libuv's thread pool.
#include <node_api.h>
#include <stdio.h>
#include <string>

#include "src/lokal_loudness.h"

namespace {

struct Job {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
#ifdef _WIN32
  std::u16string path;
#else
  std::string path;
#endif
  int32_t max_seconds = 0;
  bool opened = false;
  lokal_loudness_result result{};
};

void execute(napi_env, void *data) {
  Job *job = static_cast<Job *>(data);
#ifdef _WIN32
  FILE *f = _wfopen(reinterpret_cast<const wchar_t *>(job->path.c_str()), L"rb");
#else
  FILE *f = fopen(job->path.c_str(), "rb");
#endif
  if (!f) return;
  job->opened = true;
  job->result = lokal_loudness_measure(f, job->max_seconds, nullptr, nullptr);
  fclose(f);
}

void set_int(napi_env env, napi_value obj, const char *name, double v) {
  napi_value n;
  napi_create_double(env, v, &n);
  napi_set_named_property(env, obj, name, n);
}

void complete(napi_env env, napi_status, void *data) {
  Job *job = static_cast<Job *>(data);
  napi_value out;
  napi_create_object(env, &out);
  const lokal_loudness_result &r = job->result;
  set_int(env, out, "status", job->opened ? r.status : LOKAL_LOUDNESS_READ_ERROR);
  set_int(env, out, "lufsTenths", r.lufs_tenths);
  set_int(env, out, "peakMicro", r.peak_micro);
  set_int(env, out, "sampleRate", r.sample_rate);
  set_int(env, out, "channels", r.channels);
  set_int(env, out, "frames", static_cast<double>(r.frames));
  napi_resolve_deferred(env, job->deferred, out);
  napi_delete_async_work(env, job->work);
  delete job;
}

napi_value measure(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  Job *job = new Job();
  size_t len = 0;
#ifdef _WIN32
  napi_get_value_string_utf16(env, argv[0], nullptr, 0, &len);
  job->path.resize(len);
  napi_get_value_string_utf16(env, argv[0], &job->path[0], len + 1, &len);
#else
  napi_get_value_string_utf8(env, argv[0], nullptr, 0, &len);
  job->path.resize(len);
  napi_get_value_string_utf8(env, argv[0], &job->path[0], len + 1, &len);
#endif
  napi_get_value_int32(env, argv[1], &job->max_seconds);
  napi_value promise, name;
  napi_create_promise(env, &job->deferred, &promise);
  napi_create_string_utf8(env, "lokal-loudness", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, nullptr, name, execute, complete, job, &job->work);
  napi_queue_async_work(env, job->work);
  return promise;
}

napi_value setup(napi_env env, napi_value exports) {
  napi_value fn, version;
  napi_create_function(env, "measure", NAPI_AUTO_LENGTH, measure, nullptr, &fn);
  napi_set_named_property(env, exports, "measure", fn);
  napi_create_int32(env, LOKAL_LOUDNESS_VERSION, &version);
  napi_set_named_property(env, exports, "version", version);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, setup)
