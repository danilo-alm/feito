UPDATE tasks
SET title = ?4, revision = revision + 1
WHERE space_id = ?1 AND layer = 'working' AND id = ?2 AND revision = ?3
    AND completed_at IS NULL
    AND EXISTS (
        SELECT 1 FROM projects
        WHERE projects.space_id = tasks.space_id AND projects.layer = tasks.layer
            AND projects.id = tasks.project_id AND archived = 0
    )
RETURNING revision
