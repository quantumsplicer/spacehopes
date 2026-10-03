from functools import lru_cache
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    env: str = "dev"
    database_url: str = "postgresql+asyncpg://thoughts:thoughts@db:5432/thoughts"
    secret_key: str = "dev-secret-change-me"
    ip_salt: str = "dev-salt-change-me"
    backup_passphrase: str = "dev-backup-passphrase"
    public_url: str = "http://localhost:8080"
    owner_email: str = "owner@example.com"
    rate_limit_enabled: bool = True
    timezone: str = "Asia/Kolkata"

    s3_endpoint: str = "http://s3:8000"
    s3_access_key: str = "devaccesskey"
    s3_secret_key: str = "devsecretkey"
    s3_bucket: str = "thoughts"
    s3_region: str = "us-east-1"

    smtp_host: str = "mailpit"
    smtp_port: int = 1025
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_tls: bool = False
    mail_from: str = "Thoughts <hello@localhost>"
    resend_api_key: str = ""

    turnstile_secret: str = ""
    turnstile_site_key: str = ""
    google_client_id: str = ""
    google_client_secret: str = ""

    # Backups can go to a different bucket (and a different account/credentials) than media. Empty = same as media.
    s3_backup_bucket: str = ""
    s3_backup_endpoint: str = ""
    s3_backup_access_key: str = ""
    s3_backup_secret_key: str = ""

    # Behind a trusted proxy that sets a client-address header (Render sets CF-Connecting-IP; its network is
    # Cloudflare). Leave empty when the API sees visitors directly or sits behind our own Caddy.
    client_ip_header: str = ""
    # AVIF is nicer but costs a lot of memory/CPU to encode; turn it off on very small servers (Render free).
    image_avif: bool = True

    # The password the first owner account starts with. Set it privately on the host so the value in the public docs is useless.
    initial_admin_password: str = "admin@123"

    max_upload_bytes: int = 25 * 1024 * 1024

    @field_validator("database_url")
    @classmethod
    def _normalise_db(cls, v: str) -> str:
        """Accept the plain `postgresql://...?sslmode=require` string that Supabase/Render/Neon show you."""
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://"):]
        if v.startswith("postgresql://"):
            v = "postgresql+asyncpg://" + v[len("postgresql://"):]
        return v.replace("sslmode=", "ssl=")

    @property
    def enforce_password_change(self) -> bool:
        """Outside development, the default password must be changed before anything else works."""
        return not self.is_dev

    @property
    def is_dev(self) -> bool:
        return self.env == "dev"


@lru_cache
def get_config() -> Config:
    return Config()


cfg = get_config()
