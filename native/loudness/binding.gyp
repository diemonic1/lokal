{
  "targets": [{
    "target_name": "lokal_loudness",
    "sources": [
      "addon.cc",
      "src/lokal_loudness.cpp",
      "vendor/pvmp3/src/pvmp3_normalize.cpp",
      "vendor/pvmp3/src/pvmp3_alias_reduction.cpp",
      "vendor/pvmp3/src/pvmp3_crc.cpp",
      "vendor/pvmp3/src/pvmp3_decode_header.cpp",
      "vendor/pvmp3/src/pvmp3_decode_huff_cw.cpp",
      "vendor/pvmp3/src/pvmp3_getbits.cpp",
      "vendor/pvmp3/src/pvmp3_dequantize_sample.cpp",
      "vendor/pvmp3/src/pvmp3_framedecoder.cpp",
      "vendor/pvmp3/src/pvmp3_get_main_data_size.cpp",
      "vendor/pvmp3/src/pvmp3_get_side_info.cpp",
      "vendor/pvmp3/src/pvmp3_get_scale_factors.cpp",
      "vendor/pvmp3/src/pvmp3_mpeg2_get_scale_data.cpp",
      "vendor/pvmp3/src/pvmp3_mpeg2_get_scale_factors.cpp",
      "vendor/pvmp3/src/pvmp3_mpeg2_stereo_proc.cpp",
      "vendor/pvmp3/src/pvmp3_huffman_decoding.cpp",
      "vendor/pvmp3/src/pvmp3_huffman_parsing.cpp",
      "vendor/pvmp3/src/pvmp3_tables.cpp",
      "vendor/pvmp3/src/pvmp3_imdct_synth.cpp",
      "vendor/pvmp3/src/pvmp3_mdct_6.cpp",
      "vendor/pvmp3/src/pvmp3_dct_6.cpp",
      "vendor/pvmp3/src/pvmp3_poly_phase_synthesis.cpp",
      "vendor/pvmp3/src/pvmp3_equalizer.cpp",
      "vendor/pvmp3/src/pvmp3_seek_synch.cpp",
      "vendor/pvmp3/src/pvmp3_stereo_proc.cpp",
      "vendor/pvmp3/src/pvmp3_reorder.cpp",
      "vendor/pvmp3/src/pvmp3_polyphase_filter_window.cpp",
      "vendor/pvmp3/src/pvmp3_mdct_18.cpp",
      "vendor/pvmp3/src/pvmp3_dct_9.cpp",
      "vendor/pvmp3/src/pvmp3_dct_16.cpp"
    ],
    "include_dirs": ["src", "vendor/pvmp3/include", "vendor/pvmp3/src"],
    "defines": ["NAPI_VERSION=6"],
    "cflags": ["-include", "compat.h", "-ffp-contract=off", "-fwrapv"],
    "cflags_cc": ["-std=c++17", "-include", "compat.h", "-ffp-contract=off", "-fwrapv"],
    "conditions": [
      ["OS=='mac'", {"xcode_settings": {"CLANG_CXX_LANGUAGE_STANDARD": "c++17", "OTHER_CPLUSPLUSFLAGS": ["-include", "compat.h", "-ffp-contract=off", "-fwrapv"]}}],
      ["OS=='win'", {"msvs_settings": {"VCCLCompilerTool": {"AdditionalOptions": ["/fp:precise", "/FIcompat.h"]}}}]
    ]
  }]
}
