-- Telegram: a family member links their chat by sharing their phone number with the bot.
ALTER TABLE family_members ADD COLUMN telegram_chat_id TEXT;
CREATE INDEX family_members_phone ON family_members (phone);
