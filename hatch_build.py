"""Hatch build hook for bundling the MindRoom Chat-based frontend."""

from __future__ import annotations

import os
import shutil
import subprocess
import time
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

_INSTALL_MAX_ATTEMPTS = 3
_INSTALL_RETRY_DELAY_SECONDS = 2.0
_BUILD_FRONTEND_ENV = "MINDROOM_BUILD_FRONTEND"
_GIT_LFS_POINTER_PREFIX = b"version https://git-lfs.github.com/spec/v1\n"


class FrontendBuildHook(BuildHookInterface):
    """Build the bundled project chat frontend before creating a distributable wheel."""

    def initialize(self, version: str, build_data: dict[str, object]) -> None:
        """Build dashboard assets when the current build target needs them."""
        should_build_editable = version == "editable" and _env_flag_enabled(_BUILD_FRONTEND_ENV)
        if self.target_name != "wheel" or (version != "standard" and not should_build_editable):
            return

        frontend_dir = Path(self.root) / "mindroom-chat"
        if not frontend_dir.is_dir():
            msg = f"Frontend sources not found at {frontend_dir}"
            raise RuntimeError(msg)

        npm = shutil.which("npm")
        if npm is None:
            msg = _missing_npm_message(version)
            raise RuntimeError(msg)
        bun = shutil.which("bun")
        if bun is None:
            msg = _missing_bun_message(version)
            raise RuntimeError(msg)

        output_dir = _get_output_dir(frontend_dir, self.directory, version)
        _build_frontend(frontend_dir, output_dir, npm, bun)

        if version == "editable":
            return

        force_include = build_data.setdefault("force_include", {})
        if not isinstance(force_include, dict):
            msg = "Wheel build data force_include must be a dictionary"
            raise TypeError(msg)
        force_include[str(output_dir)] = "mindroom/_frontend"


def _env_flag_enabled(name: str) -> bool:
    """Return whether an environment flag has a truthy value."""
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _missing_npm_message(version: str) -> str:
    if version == "editable":
        return f"npm is required when {_BUILD_FRONTEND_ENV}=1. Install Node.js or unset {_BUILD_FRONTEND_ENV}."
    return "npm is required to build the bundled frontend for wheel distributions. Install Node.js or use a prebuilt wheel."


def _missing_bun_message(version: str) -> str:
    if version == "editable":
        return f"bun is required when {_BUILD_FRONTEND_ENV}=1. Install bun or unset {_BUILD_FRONTEND_ENV}."
    return "bun is required to build the bundled Connections page for wheel distributions. Install bun or use a prebuilt wheel."


def _get_output_dir(frontend_dir: Path, build_directory: str, version: str) -> Path:
    """Return the frontend build output directory for the requested build mode."""
    if version == "editable":
        return frontend_dir / "dist"
    return Path(build_directory).parent / ".frontend-build" / "frontend-dist"


def _build_frontend(frontend_dir: Path, output_dir: Path, npm: str, bun: str) -> None:
    """Install frontend deps and write a production build to the output directory."""
    shutil.rmtree(output_dir, ignore_errors=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    _run_command(
        [npm, "ci"],
        cwd=frontend_dir,
        retries=_INSTALL_MAX_ATTEMPTS,
        retry_delay_seconds=_INSTALL_RETRY_DELAY_SECONDS,
    )
    _run_command([npm, "run", "typecheck"], cwd=frontend_dir)
    _run_command([npm, "run", "build"], cwd=frontend_dir)
    built_dist = frontend_dir / "dist"
    if output_dir.resolve() != built_dist.resolve():
        shutil.copytree(built_dist, output_dir, dirs_exist_ok=True)
    dashboard_dir = Path(__file__).resolve().parent / "frontend"
    _run_command(
        [bun, "install", "--frozen-lockfile"],
        cwd=dashboard_dir,
        retries=_INSTALL_MAX_ATTEMPTS,
        retry_delay_seconds=_INSTALL_RETRY_DELAY_SECONDS,
    )
    _run_command(
        [
            bun,
            "run",
            "vite",
            "build",
            "--config",
            "vite.connections.config.ts",
            "--outDir",
            str(output_dir / "connections"),
        ],
        cwd=dashboard_dir,
    )
    _assert_no_git_lfs_pointers(output_dir)


def _assert_no_git_lfs_pointers(output_dir: Path) -> None:
    """Reject frontend builds that accidentally bundle unresolved Git LFS pointers."""
    pointer_files = [
        path.relative_to(output_dir).as_posix()
        for path in output_dir.rglob("*")
        if path.is_file() and path.read_bytes().startswith(_GIT_LFS_POINTER_PREFIX)
    ]
    if not pointer_files:
        return

    joined = ", ".join(pointer_files)
    msg = f"Frontend build contains unresolved Git LFS pointer assets: {joined}. Run git lfs pull before building."
    raise RuntimeError(msg)


def _run_command(
    cmd: list[str],
    *,
    cwd: Path,
    retries: int = 1,
    retry_delay_seconds: float = 0.0,
) -> None:
    """Run one build command, retrying transient subprocess failures when configured."""
    max_attempts = max(1, retries)
    for attempt in range(1, max_attempts + 1):
        try:
            subprocess.run(cmd, check=True, cwd=cwd)
        except subprocess.CalledProcessError:
            if attempt >= max_attempts:
                raise
            if retry_delay_seconds > 0:
                time.sleep(retry_delay_seconds)
        else:
            return
