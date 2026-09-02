CREATE TABLE IF NOT EXISTS master_data (
  paravet_id TEXT PRIMARY KEY,
  division TEXT NOT NULL DEFAULT '',
  district TEXT NOT NULL DEFAULT '',
  block TEXT NOT NULL DEFAULT '',
  vehicle_number TEXT NOT NULL DEFAULT '',
  week_off TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_master_data_district ON master_data(district);
CREATE INDEX IF NOT EXISTS idx_master_data_division ON master_data(division);
