import datetime as dt
from sqlalchemy import (Boolean, Computed, Date, DateTime, ForeignKey, Index, Integer, String, Text)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def now():
    return dt.datetime.now(dt.timezone.utc)


class Base(DeclarativeBase):
    pass


TS = DateTime(timezone=True)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    login_id: Mapped[str] = mapped_column(String(32), unique=True)
    password_hash: Mapped[str] = mapped_column(String(300))
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    password_changed_at: Mapped[dt.datetime | None] = mapped_column(TS)
    email: Mapped[str] = mapped_column(String(254), unique=True)  # for sign-in alerts only
    name: Mapped[str] = mapped_column(String(80), default="")
    role: Mapped[str] = mapped_column(String(16), default="owner")  # owner | editor
    created_at: Mapped[dt.datetime] = mapped_column(TS, default=now)
    last_login_at: Mapped[dt.datetime | None] = mapped_column(TS)
    last_login_device: Mapped[str | None] = mapped_column(String(200))








class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # sha256 of the cookie token
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    stage: Mapped[str] = mapped_column(String(8), default="full")
    csrf: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[dt.datetime] = mapped_column(TS, default=now)
    last_seen_at: Mapped[dt.datetime] = mapped_column(TS, default=now)
    expires_at: Mapped[dt.datetime] = mapped_column(TS)
    ip_hash: Mapped[str] = mapped_column(String(64))
    user_agent: Mapped[str] = mapped_column(String(200), default="")




class AuthFailure(Base):
    __tablename__ = "auth_failures"
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[dt.datetime] = mapped_column(TS, default=now)


class AuditLog(Base):  # append-only: a trigger blocks UPDATE and DELETE (see the first migration)
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[dt.datetime] = mapped_column(TS, default=now, index=True)
    user_id: Mapped[int | None] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(80))
    target: Mapped[str | None] = mapped_column(String(120))
    detail: Mapped[dict | None] = mapped_column(JSONB)
    ip_hash: Mapped[str | None] = mapped_column(String(64))


class Media(Base):
    __tablename__ = "media"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(10))  # image | drawing
    prefix: Mapped[str] = mapped_column(String(80), unique=True)  # random storage prefix
    variants: Mapped[dict] = mapped_column(JSONB, default=dict)  # {"webp": [640,1280], "avif": [...], "png": true, "svg": true}
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    blurhash: Mapped[str | None] = mapped_column(String(80))
    alt: Mapped[str] = mapped_column(String(300), default="")
    caption: Mapped[str] = mapped_column(String(300), default="")
    drawing_json_key: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(TS, default=now)
    updated_at: Mapped[dt.datetime] = mapped_column(TS, default=now, onupdate=now)


class Topic(Base):
    __tablename__ = "topics"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(60), unique=True)
    name: Mapped[str] = mapped_column(String(60))


class PostTopic(Base):
    __tablename__ = "post_topics"
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id", ondelete="CASCADE"), primary_key=True)


class Post(Base):
    __tablename__ = "posts"
    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(10))  # thought | blog
    slug: Mapped[str | None] = mapped_column(String(160), unique=True)
    title: Mapped[str | None] = mapped_column(String(240))
    standfirst: Mapped[str | None] = mapped_column(String(500))
    body_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    body_text: Mapped[str] = mapped_column(Text, default="")
    excerpt: Mapped[str] = mapped_column(String(500), default="")
    cover_media_id: Mapped[int | None] = mapped_column(ForeignKey("media.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(12), default="draft", index=True)  # draft|scheduled|published
    publish_at: Mapped[dt.datetime | None] = mapped_column(TS, index=True)
    comments_open: Mapped[bool] = mapped_column(Boolean, default=True)
    read_minutes: Mapped[int] = mapped_column(Integer, default=1)
    search_tsv = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('english', coalesce(title,'') || ' ' || coalesce(standfirst,'') || ' ' || coalesce(body_text,''))",
                 persisted=True))
    created_at: Mapped[dt.datetime] = mapped_column(TS, default=now)
    updated_at: Mapped[dt.datetime] = mapped_column(TS, default=now, onupdate=now)
    topics: Mapped[list[Topic]] = relationship(secondary="post_topics", lazy="selectin")
    cover: Mapped[Media | None] = relationship(lazy="selectin", foreign_keys=[cover_media_id])
    __table_args__ = (Index("ix_posts_search", "search_tsv", postgresql_using="gin"),)


class PostVersion(Base):
    __tablename__ = "post_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    title: Mapped[str | None] = mapped_column(String(240))
    standfirst: Mapped[str | None] = mapped_column(String(500))
    body_json: Mapped[dict] = mapped_column(JSONB)
    author_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[dt.datetime] = mapped_column(TS, default=now)


class ReaderAccount(Base):
    __tablename__ = "reader_accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)  # never displayed
    display_name: Mapped[str] = mapped_column(String(60))
    provider: Mapped[str] = mapped_column(String(10), default="otp")
    created_at: Mapped[dt.datetime] = mapped_column(TS, default=now)


class ReaderOtp(Base):
    __tablename__ = "reader_otps"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), index=True)
    name: Mapped[str] = mapped_column(String(60), default="")
    code_hash: Mapped[str] = mapped_column(String(128))
    expires_at: Mapped[dt.datetime] = mapped_column(TS)
    attempts: Mapped[int] = mapped_column(Integer, default=0)


class Comment(Base):
    __tablename__ = "comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("comments.id", ondelete="CASCADE"))
    author_name: Mapped[str] = mapped_column(String(60))
    reader_account_id: Mapped[int | None] = mapped_column(ForeignKey("reader_accounts.id", ondelete="SET NULL"))
    is_author: Mapped[bool] = mapped_column(Boolean, default=False)
    body: Mapped[str] = mapped_column(String(2000))
    status: Mapped[str] = mapped_column(String(10), default="waiting", index=True)  # waiting|approved|hidden|spam
    flags: Mapped[list] = mapped_column(JSONB, default=list)
    ip_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    likes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(TS, default=now)
    post: Mapped[Post] = relationship(lazy="selectin")


class CommentLike(Base):
    __tablename__ = "comment_likes"
    comment_id: Mapped[int] = mapped_column(ForeignKey("comments.id", ondelete="CASCADE"), primary_key=True)
    anon_hash: Mapped[str] = mapped_column(String(64), primary_key=True)


class Block(Base):
    __tablename__ = "blocks"
    id: Mapped[int] = mapped_column(primary_key=True)
    ip_hash: Mapped[str] = mapped_column(String(64), unique=True)
    reason: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[dt.datetime] = mapped_column(TS, default=now)


class Reaction(Base):
    __tablename__ = "reactions"
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    kind: Mapped[str] = mapped_column(String(10), primary_key=True)  # agree | think
    anon_id_hash: Mapped[str] = mapped_column(String(64), primary_key=True)


class Subscriber(Base):
    __tablename__ = "subscribers"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    status: Mapped[str] = mapped_column(String(14), default="pending")  # pending|confirmed|unsubscribed
    token: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[dt.datetime] = mapped_column(TS, default=now)
    confirmed_at: Mapped[dt.datetime | None] = mapped_column(TS)


class ContactMessage(Base):
    __tablename__ = "contact_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    email: Mapped[str] = mapped_column(String(254))
    topic: Mapped[str] = mapped_column(String(40))
    message: Mapped[str] = mapped_column(String(4000))
    created_at: Mapped[dt.datetime] = mapped_column(TS, default=now)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)


class SiteSettings(Base):
    __tablename__ = "settings"
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    comment_mode: Mapped[str] = mapped_column(String(10), default="name")  # name | signed_in
    review_comments: Mapped[bool] = mapped_column(Boolean, default=True)
    disable_copy: Mapped[bool] = mapped_column(Boolean, default=True)
    watermark: Mapped[bool] = mapped_column(Boolean, default=False)
    site_name: Mapped[str] = mapped_column(String(60), default="Space hopes")
    about_quote: Mapped[str] = mapped_column(
        String(400), default="Judge the thought, not the thinker. The words here are meant to stand on their own.")
    about_byline: Mapped[str] = mapped_column(String(120), default="Saravanan Murugan, IAS")
    about_quote_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    footer_line: Mapped[str] = mapped_column(String(200), default="Views expressed are my own.")
    social_links: Mapped[list] = mapped_column(JSONB, default=lambda: [{"label": "LinkedIn", "url": "https://www.linkedin.com/in/saravanan-murugan-947369b9"}])  # [{"label","url"}]
    blocklist: Mapped[list] = mapped_column(JSONB, default=list)


class DailyStat(Base):
    __tablename__ = "daily_stats"
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    visitors: Mapped[int] = mapped_column(Integer, default=0)
    readers: Mapped[int] = mapped_column(Integer, default=0)
    new_subscribers: Mapped[int] = mapped_column(Integer, default=0)


class PostDailyRead(Base):
    __tablename__ = "post_daily_reads"
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    readers: Mapped[int] = mapped_column(Integer, default=0)
