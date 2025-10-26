-- Add TUS support fields to media table
-- Migration: add_tus_fields_to_media

-- Add new columns for TUS support
ALTER TABLE media
ADD COLUMN IF NOT EXISTS tus_id TEXT,
ADD COLUMN IF NOT EXISTS upload_completed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Remove original_size column as we're not doing compression
ALTER TABLE media
DROP COLUMN IF EXISTS original_size;

-- Update existing records to set upload_completed = true
UPDATE media SET upload_completed = TRUE WHERE url IS NOT NULL AND url != '';

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_media_tus_id ON media(tus_id);
CREATE INDEX IF NOT EXISTS idx_media_upload_completed ON media(upload_completed);
CREATE INDEX IF NOT EXISTS idx_media_organization_completed ON media(organization_id, upload_completed);