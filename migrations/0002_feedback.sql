-- 问题反馈：修行问题 / 系统问题
-- 提报人通过 /feedback/ 提交，运营在 /ops/ 查看
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,          -- practice | system
  content TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'  -- new | read | archived
);

CREATE INDEX IF NOT EXISTS idx_feedback_created
  ON feedback (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_type_status
  ON feedback (type, status);
