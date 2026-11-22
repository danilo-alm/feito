SELECT id, project_id, section_id, parent_id, revision, occurrence_id,
       title, description, priority, position, created_at, completed_at, due_date, due_time, recurrence_rule
FROM tasks
WHERE space_id = ?1 AND layer = ?2 AND id = ?3
