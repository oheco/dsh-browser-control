# Third-party inputs

`tpr/ws/` contains the complete JavaScript distribution of ws 8.21.0, copied unchanged from the installed DSH runtime. Upstream: https://github.com/websockets/ws . Registry archive: https://registry.npmjs.org/ws/-/ws-8.21.0.tgz . License: MIT; original notice is retained in `tpr/ws/LICENSE`. Archive SHA-256: `d08b726b3aae3a0fed5218a0d9a4b2ac8d75d4ad453a9271db55fe38e94eb4cf` (34987 bytes). The official archive was fetched through the configured proxy and compared with the vendored files during native verification.

ws runs with its built-in JavaScript implementation; optional native bufferutil and utf-8-validate addons are not required. No npm download, compiler, native messaging host or external browser driver is needed for build or runtime. DSH supplies its own public tool APIs for the Host entry.
