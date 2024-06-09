-- PB schema
-- In the old KV design, they use metadata to store password, date, etc.
-- But there's no such metadata in SQLite (D1).
-- So we create a new table for them.
-- short: the short url (string)
-- content: the paste or file content (blob)
-- metadata: JSON string of metadata (string)
DROP TABLE IF EXISTS pastes;
CREATE TABLE IF NOT EXISTS pastes (
    short TEXT PRIMARY KEY,
    content BLOB,
    metadata TEXT
)
