UPDATE selection SET generation = generation + 1
WHERE id = 1 AND space_id = ?1 AND epoch = ?2 AND generation = ?3
RETURNING generation
