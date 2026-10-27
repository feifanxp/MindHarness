"""Named-team discussion guidance reaches the coordinator without leaking to other teams."""

from pathlib import Path
from unittest.mock import patch

import pytest
from agno.agent import Agent

from mindroom.config.agent import AgentConfig, TeamConfig
from mindroom.config.main import Config
from mindroom.teams import TeamMode, _create_team_instance
from tests.conftest import FakeModel, bind_runtime_paths, runtime_paths_for, test_runtime_paths


@pytest.mark.parametrize(
    ("team_name", "expected"),
    [("discussion", ["Keep discussion brief; expand when requested."]), ("other", []), (None, None)],
)
def test_coordinator_instructions_are_scoped_to_named_team(
    tmp_path: Path,
    team_name: str | None,
    expected: list[str] | None,
) -> None:
    """The actual Agno coordinator receives only its own configured instructions."""
    config = Config(
        agents={"expert": AgentConfig(display_name="Expert", role="Compare options")},
        teams={
            "discussion": TeamConfig(
                display_name="Discussion",
                role="Discuss",
                agents=["expert"],
                instructions=["Keep discussion brief; expand when requested."],
            ),
            "other": TeamConfig(display_name="Other", role="Report", agents=["expert"]),
        },
    )
    config = bind_runtime_paths(config, test_runtime_paths(tmp_path))
    model = FakeModel(id="fake-model", provider="fake")
    member = Agent(id="expert", name="Expert", model=model, instructions=["Member guidance"])
    with patch("mindroom.providers.model_loading.get_model_instance", return_value=model):
        team = _create_team_instance(
            agents=[member],
            mode=TeamMode.COLLABORATE,
            config=config,
            runtime_paths=runtime_paths_for(config),
            team_display_name="Discussion",
            scope_context=None,
            execution_identity=None,
            model_name="default",
            configured_team_name=team_name,
        )
    assert team.instructions == expected
    assert member.instructions == ["Member guidance"]
