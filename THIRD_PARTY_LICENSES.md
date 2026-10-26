# Third-Party Licenses

This project includes code and binaries from the following open source projects.

## Claude Code runtime (derived source)

The root `src/` runtime is derived from third-party source code. EchoFlow Code
claims no copyright in those portions and grants no licence to them.

This repository's first commit carried the following notice. It is preserved
here verbatim as the provenance record for the derived portions:

> DISCLAIMER AND LICENSE
>
> Copyright (c) 2026 Anthropic, PBC. All rights reserved for the original source code.
>
> This repository is based on the Claude Code source code leaked from the Anthropic
> npm registry on 2026-03-31. All original source code copyrights belong to Anthropic.
>
> THIS SOFTWARE IS PROVIDED FOR EDUCATIONAL AND RESEARCH PURPOSES ONLY.
>
> The purpose of this repository is to facilitate the study and research of AI Agent
> engineering, including but not limited to:
> - Agent architecture and design patterns
> - Tool use and function calling mechanisms
> - Multi-agent orchestration
> - Terminal UI (TUI) implementation for AI applications
> - MCP (Model Context Protocol) integration
>
> RESTRICTIONS:
>
> 1. This software SHALL NOT be used for any commercial purposes.
> 2. This software SHALL NOT be used to compete with or replicate Anthropic's
>    commercial products or services.
> 3. This software SHALL NOT be redistributed, sublicensed, or sold in any form.
> 4. Users SHALL comply with all applicable laws and regulations in their jurisdiction.
>
> NO WARRANTY:
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
> PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
> HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
> OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
> SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
>
> By using this software, you acknowledge that:
> - You understand this is leaked source code and all original rights belong to Anthropic.
> - You will use it solely for learning and research of Agent engineering.
> - You assume all legal risks and responsibilities arising from the use of this software.

### Licensing history of the derived portions

Recorded from this repository's own git history, so the change in statements is
auditable:

| Commit | Date | What the repository's LICENSE said |
| --- | --- | --- |
| `8bb3c0e11` | 2026-04-04 | The disclaimer quoted above. |
| `9e9b5eeea` | 2026-07-29 | Replaced the disclaimer with an MIT licence under a different copyright holder (`cc-haha`). A repository cannot relicense third-party proprietary source by editing its own LICENSE file, so this did not widen anyone's rights to the derived portions. The notice above remains the record of provenance. |
| `629ed2a2e` | 2026-09-17 | Copyright line changed to `LiuGuangHS / EchoFlow Code`, MIT text retained. |
| — | 2026-10-26 | Original work moved to a proprietary licence in `LICENSE`. Derived portions remain third-party and are not covered by it. |

### Open item

`src/` is large and is being progressively replaced with independently written
code. Until that completes, any distribution of this product needs legal review
of the derived portions. This file records provenance; it is not that review.

## ripgrep

- Project: ripgrep (https://github.com/BurntSushi/ripgrep)
- Included as: platform-specific desktop search executable
- Version: 15.1.0
- License: dual-licensed under MIT or the Unlicense
- License texts: bundled beside the executable under `ripgrep-licenses/`

## pdf.js

- Project: pdf.js (https://github.com/mozilla/pdf.js), distributed as `pdfjs-dist`
- Included as: the PDF engine and its worker, loaded when a PDF is opened in the workspace, and the run-time data files it reads, emitted beside the app under `assets/pdfjs-<version>/`
- Adapted in: `desktop/src/components/workspace/surfaces/document/pdfPage.css` (the text-layer rules of `web/pdf_viewer.css`)
- Version: 6.3.289
- License: Apache-2.0
- Bundled data files, each folder shipped unmodified with its own license files:
  - `cmaps/`: character maps, Copyright 1990-2009 Adobe Systems Incorporated (BSD-style license, `cmaps/LICENSE`)
  - `standard_fonts/`: Foxit fonts (Copyright PDFium Authors, BSD-3-Clause, `LICENSE_FOXIT`) and Liberation Sans fonts (Liberation Font License, GNU GPL v2 with a font exception, `LICENSE_LIBERATION`), kept as separate data files
  - `wasm/`: image decoders OpenJPEG (BSD-2-Clause), JBIG2 from PDFium (BSD-3-Clause) and qcms (MIT), with pdf.js' wrappers for them; each license is in a `LICENSE_*` file beside the decoder
  - `iccs/`: an ICC colour profile (CC0 1.0, `iccs/LICENSE`)

## claude-tap

- Project: claude-tap (https://github.com/liaohch3/claude-tap)
- Adapted in: `desktop/src/lib/trace/sse.ts` (SSE stream reassembly, ported from Python to TypeScript)
- License: MIT

```
MIT License

Copyright (c) 2025 liaohch3

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
