#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import os
import uuid

from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.types import Message

from database.repository import Responder, build_responder_repository


bot = Bot(token=os.environ["TELEGRAM_BOT_TOKEN"])
dp = Dispatcher()
repository = build_responder_repository(os.getenv("DB_URI"))


@dp.message(Command("start"))
async def start(message: Message) -> None:
    await message.answer("Send your live location to register as an active Sentinel responder.")


@dp.message(F.location)
async def register_location(message: Message) -> None:
    assert message.location is not None
    responder = Responder(
        id=str(message.from_user.id if message.from_user else uuid.uuid4()),
        telegram_chat_id=str(message.chat.id),
        display_name=message.from_user.full_name if message.from_user else "Responder",
        latitude=message.location.latitude,
        longitude=message.location.longitude,
        active=True,
    )
    repository.upsert(responder)
    await message.answer("Responder location registered.")


async def main() -> None:
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
