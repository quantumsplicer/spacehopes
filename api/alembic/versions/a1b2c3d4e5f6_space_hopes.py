"""Space hopes: byline setting, new site name, LinkedIn link

Revision ID: a1b2c3d4e5f6
Revises: df1ed13982a5
"""
from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "df1ed13982a5"
branch_labels = None
depends_on = None

LINKEDIN = "https://www.linkedin.com/in/saravanan-murugan-947369b9"


def upgrade() -> None:
    op.add_column("settings", sa.Column("about_byline", sa.String(120), nullable=False, server_default="Saravanan Murugan, IAS"))
    # Only touch rows still on the old defaults, so anything the owner already edited is kept.
    op.execute("UPDATE settings SET site_name = 'Space hopes' WHERE site_name = 'Name'")
    op.execute(f"""UPDATE settings SET social_links = '[{{"label": "LinkedIn", "url": "{LINKEDIN}"}}]'::jsonb
                   WHERE social_links = '[]'::jsonb""")


def downgrade() -> None:
    op.drop_column("settings", "about_byline")
