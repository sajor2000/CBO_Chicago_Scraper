-- Runtime readiness checks may read migration state but may never mutate it.
grant select on review_workspace.schema_migrations to review_workspace_app;
