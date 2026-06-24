# DeerFlow Reports

DeerFlow is now installed and able to run locally on this host.

Setup completed:

- `uv` installed in `/home/abhi/.local/bin`.
- `nginx` is available.
- Docker build cache was pruned, freeing enough disk for setup.
- DeerFlow source checkout exists at `packages/deepresearch/external/deer-flow`.
- `make check`, `make install`, and `make doctor` pass.
- DeerFlow is configured with:
  - Claude Code OAuth provider via `ANTHROPIC_AUTH_TOKEN`.
  - Firecrawl for `web_search` and `web_fetch`.
  - Local sandbox mode.

Local checkout patches:

- The default Jina fetch tool failed with 401, so active web search/fetch were switched to Firecrawl.
- The Claude provider rejected DeerFlow's dynamic-context `SystemMessage` ordering, so the local checkout was patched to emit dynamic context as a hidden `HumanMessage` for this smoke test.

Generated reports:

- `kennedy-valve.md`: embedded-client final response.
- `kennedy-valve-full.md`: full DeerFlow artifact written under the thread's `user-data/outputs`.

The full artifact is more useful than the final chat response. The final response summarizes the generated deliverable and does not reliably preserve the requested JSON shape.
