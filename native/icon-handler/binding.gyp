{
  "targets": [{
    "target_name": "LokalIconHandler",
    "type": "shared_library",
    "win_delay_load_hook": "false",
    "sources": ["icon_handler.cpp", "icon_handler.def"],
    "defines": ["UNICODE", "_UNICODE"],
    "msvs_settings": {
      "VCCLCompilerTool": { "AdditionalOptions": ["/std:c++17", "/EHa"], "RuntimeLibrary": 0 }
    },
    "libraries": ["ole32.lib", "shell32.lib", "shlwapi.lib", "user32.lib", "gdi32.lib", "advapi32.lib"]
  }]
}
