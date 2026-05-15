from __future__ import annotations

import dataclasses
import os
from collections.abc import Sequence
from contextlib import AbstractContextManager
from typing import Protocol

from sqlalchemy import Boolean, Float, String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


class Base(DeclarativeBase):
    pass


class ResponderModel(Base):
    __tablename__ = "responders"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    telegram_chat_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    email: Mapped[str | None] = mapped_column(String(240), nullable=True)
    github: Mapped[str | None] = mapped_column(String(120), nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


@dataclasses.dataclass(frozen=True, slots=True)
class Responder:
    id: str
    telegram_chat_id: str
    display_name: str
    latitude: float
    longitude: float
    phone: str | None = None
    email: str | None = None
    github: str | None = None
    photo_url: str | None = None
    active: bool = True


class ResponderRepository(Protocol):
    def upsert(self, responder: Responder) -> None:
        ...

    def list_active(self) -> Sequence[Responder]:
        ...


class SqlAlchemyResponderRepository:
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def upsert(self, responder: Responder) -> None:
        with self._session_factory.begin() as session:
            model = session.get(ResponderModel, responder.id)
            if model is None:
                model = ResponderModel(id=responder.id)
                session.add(model)
            model.telegram_chat_id = responder.telegram_chat_id
            model.display_name = responder.display_name
            model.phone = responder.phone
            model.email = responder.email
            model.github = responder.github
            model.photo_url = responder.photo_url
            model.latitude = responder.latitude
            model.longitude = responder.longitude
            model.active = responder.active

    def list_active(self) -> Sequence[Responder]:
        with self._session_factory() as session:
            rows = session.scalars(select(ResponderModel).where(ResponderModel.active.is_(True))).all()
            return [
                Responder(
                    id=row.id,
                    telegram_chat_id=row.telegram_chat_id,
                    display_name=row.display_name,
                    latitude=row.latitude,
                    longitude=row.longitude,
                    phone=row.phone,
                    email=row.email,
                    github=row.github,
                    photo_url=row.photo_url,
                    active=row.active,
                )
                for row in rows
            ]


def build_session_factory(db_uri: str | None = None) -> sessionmaker[Session]:
    uri = db_uri or os.getenv("DB_URI", "sqlite:///database/sentinel.db")
    engine = create_engine(uri, pool_pre_ping=True, future=True)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False, future=True)


def build_responder_repository(db_uri: str | None = None) -> ResponderRepository:
    return SqlAlchemyResponderRepository(build_session_factory(db_uri))
