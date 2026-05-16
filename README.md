# Codiff

Codiff is a local PR viewer for reviewing staged and unstaged Git changes before
committing.

## Usage

```bash
vp install
vp build
vpr codiff
```

Run it from any Git repository, or pass a path:

```bash
vpr codiff /path/to/repository
```

The packaged CLI is named `codiff`. Launching it in multiple repositories opens
a separate native window for each repository.

The renderer talks to a source-based repository API. The first UI uses the
`working-tree` source for staged and unstaged changes; the Electron bridge also
has commit history and commit-diff sources ready for the later history picker.

## Development

```bash
vpr dev
ELECTRON_RENDERER_URL=http://127.0.0.1:5173 vpr electron
```

Useful checks:

```bash
vp check
vp test
vp build
```
