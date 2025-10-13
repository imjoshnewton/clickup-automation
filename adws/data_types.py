"""Data types for GitHub API responses, ClickUp API responses, and Claude Code agent."""

from datetime import datetime
from typing import Optional, List, Literal, Dict, Any
from pydantic import BaseModel, Field

# Supported slash commands for issue classification
# These should align with your custom slash commands in .claude/commands that you want to run
IssueClassSlashCommand = Literal["/chore", "/bug", "/feature"]

# All slash commands used in the ADW system
# Includes issue classification commands and ADW-specific commands
SlashCommand = Literal[
    # Issue classification commands
    "/chore",
    "/bug",
    "/feature",
    # ADW workflow commands
    "/classify_issue",
    "/find_plan_file",
    "/generate_branch_name",
    "/commit",
    "/pull_request",
    "/implement",
]


class GitHubUser(BaseModel):
    """GitHub user model."""

    id: Optional[str] = None  # Not always returned by GitHub API
    login: str
    name: Optional[str] = None
    is_bot: bool = Field(default=False, alias="is_bot")


class GitHubLabel(BaseModel):
    """GitHub label model."""

    id: str
    name: str
    color: str
    description: Optional[str] = None


class GitHubMilestone(BaseModel):
    """GitHub milestone model."""

    id: str
    number: int
    title: str
    description: Optional[str] = None
    state: str


class GitHubComment(BaseModel):
    """GitHub comment model."""

    id: str
    author: GitHubUser
    body: str
    created_at: datetime = Field(alias="createdAt")
    updated_at: Optional[datetime] = Field(
        None, alias="updatedAt"
    )  # Not always returned


class GitHubIssueListItem(BaseModel):
    """GitHub issue model for list responses (simplified)."""

    number: int
    title: str
    body: str
    labels: List[GitHubLabel] = []
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    class Config:
        populate_by_name = True


class GitHubIssue(BaseModel):
    """GitHub issue model."""

    number: int
    title: str
    body: str
    state: str
    author: GitHubUser
    assignees: List[GitHubUser] = []
    labels: List[GitHubLabel] = []
    milestone: Optional[GitHubMilestone] = None
    comments: List[GitHubComment] = []
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    closed_at: Optional[datetime] = Field(None, alias="closedAt")
    url: str

    class Config:
        populate_by_name = True


class AgentPromptRequest(BaseModel):
    """Claude Code agent prompt configuration."""

    prompt: str
    adw_id: str
    agent_name: str = "ops"
    model: Literal["sonnet", "opus"] = "opus"
    dangerously_skip_permissions: bool = False
    output_file: str


class AgentPromptResponse(BaseModel):
    """Claude Code agent response."""

    output: str
    success: bool
    session_id: Optional[str] = None


class AgentTemplateRequest(BaseModel):
    """Claude Code agent template execution request."""

    agent_name: str
    slash_command: SlashCommand
    args: List[str]
    adw_id: str
    model: Literal["sonnet", "opus"] = "sonnet"


class ClaudeCodeResultMessage(BaseModel):
    """Claude Code JSONL result message (last line)."""

    type: str
    subtype: str
    is_error: bool
    duration_ms: int
    duration_api_ms: int
    num_turns: int
    result: str
    session_id: str
    total_cost_usd: float


# ============================================
# ClickUp Models
# ============================================


class ClickUpStatus(BaseModel):
    """ClickUp task status."""

    status: str
    color: str
    orderindex: int
    type: str


class ClickUpCustomField(BaseModel):
    """ClickUp custom field."""

    id: str
    name: str
    type: str
    value: Optional[Any] = None
    type_config: Optional[Dict] = None


class ClickUpUser(BaseModel):
    """ClickUp user."""

    id: int
    username: str
    email: Optional[str] = None
    color: Optional[str] = None
    profilePicture: Optional[str] = None


class ClickUpTag(BaseModel):
    """ClickUp tag."""

    name: str
    tag_fg: str
    tag_bg: str


class ClickUpTask(BaseModel):
    """ClickUp task details."""

    id: str
    name: str
    description: Optional[str] = None
    text_content: Optional[str] = None
    status: ClickUpStatus
    orderindex: str
    date_created: str
    date_updated: str
    date_closed: Optional[str] = None
    creator: ClickUpUser
    assignees: List[ClickUpUser] = []
    tags: List[ClickUpTag] = []
    custom_fields: List[ClickUpCustomField] = []
    list: Dict  # Contains list info including id
    url: str


class ClickUpComment(BaseModel):
    """ClickUp task comment."""

    id: str
    comment_text: str
    user: ClickUpUser
    date: str


# ============================================
# Generic WorkItem for Platform Abstraction
# ============================================


class WorkItem(BaseModel):
    """
    Generic work item (GitHub issue or ClickUp task).
    Used by platform adapters for unified interface.
    """

    id: str
    title: str
    description: str
    status: str
    platform: str  # "github" or "clickup"
    raw_data: Dict  # Original platform-specific data
