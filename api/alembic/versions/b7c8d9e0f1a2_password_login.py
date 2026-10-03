"""Password sign-in: login_id + password hash on users; drop passkeys, TOTP and recovery codes

Revision ID: b7c8d9e0f1a2
Revises: a1b2c3d4e5f6
"""
import os

from alembic import op
import sqlalchemy as sa

from app.services.passwords import hash_password

revision = "b7c8d9e0f1a2"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("login_id", sa.String(32), nullable=True))
    op.add_column("users", sa.Column("password_hash", sa.String(300), nullable=True))
    op.add_column("users", sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True))
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, role FROM users ORDER BY id")).fetchall()
    first_owner_done = False
    for uid, role in rows:
        if role == "owner" and not first_owner_done:
            login, pw, must = "admin", "admin@123", True  # the agreed starting credentials; the owner must change them
            first_owner_done = True
        else:
            login, pw, must = f"user{uid}", os.urandom(24).hex(), True  # unusable until the owner sets a password
        conn.execute(sa.text("UPDATE users SET login_id=:l, password_hash=:h, must_change_password=:m WHERE id=:i"),
                     {"l": login, "h": hash_password(pw), "m": must, "i": uid})
    op.alter_column("users", "login_id", nullable=False)
    op.alter_column("users", "password_hash", nullable=False)
    op.create_index("ix_users_login_id", "users", ["login_id"], unique=True)
    for t in ("webauthn_credentials", "totp_secrets", "recovery_codes", "auth_challenges"):
        op.drop_table(t)
    op.execute("DELETE FROM sessions")  # old two-step sessions are no longer valid


def downgrade() -> None:
    raise NotImplementedError("Password sign-in cannot be rolled back to passkeys.")
