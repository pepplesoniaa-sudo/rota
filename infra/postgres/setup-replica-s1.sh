#!/bin/bash
set -e

if [ -z "$(ls -A "$PGDATA")" ]; then
    echo "Running basebackup from pg-s1-primary..."
    PGPASSWORD=postgres_root_secret pg_basebackup -h pg-s1-primary -p 5432 -U replicator -D "$PGDATA" -Fp -Xs -R
fi

