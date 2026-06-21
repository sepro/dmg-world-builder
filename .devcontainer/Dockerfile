# Dockerfile for the GB World Editor project devcontainer.
# Python-based, because the editor is a static HTML file served over HTTP and the
# tooling (JSON -> C converter, world visualizer) is plain Python.
#
# Place this together with devcontainer.json in a .devcontainer/ folder at the
# repo root. See DEVELOPER_HANDOFF.md for usage.

FROM python:3.12-slim-bookworm

# Small set of dev conveniences. Pillow ships as a manylinux wheel, so no build
# toolchain is required for it; git/curl are here for everyday work in the container.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# The visualizer needs Pillow; the converter is pure standard library.
RUN pip install --no-cache-dir pillow

# Match the VS Code devcontainer convention of a non-root "vscode" user.
ARG USERNAME=vscode
ARG USER_UID=1000
ARG USER_GID=$USER_UID
RUN groupadd --gid $USER_GID $USERNAME \
 && useradd --uid $USER_UID --gid $USER_GID -m $USERNAME

USER $USERNAME
WORKDIR /workspace
EXPOSE 8000

# Default command for when the image is run directly (docker run). Note that VS
# Code overrides this with a keep-alive command inside a devcontainer, so the
# editor server is started from devcontainer.json's postStartCommand instead.
CMD ["python", "-m", "http.server", "8000"]
