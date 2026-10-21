// Forced into every file of the library (-include / /FI): what AOSP's build
// defines for pvmp3dec, and GCC attributes MSVC doesn't know.
#ifndef LOKAL_LOUDNESS_COMPAT_H
#define LOKAL_LOUDNESS_COMPAT_H

#define OSCL_UNUSED_ARG(x) (void)(x)

#if defined(_MSC_VER) && !defined(__clang__)
#define __attribute__(x)
#ifndef __has_attribute
#define __has_attribute(x) 0
#endif
#endif

#endif
