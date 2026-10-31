# Supabase database CA

`supabase-ca.crt` is the public Supabase Root 2021 CA downloaded from the project's **Database settings > SSL Configuration > Download certificate** in the Supabase dashboard. It contains no private key or project credentials.

The PostgreSQL adapter uses this trust anchor with `rejectUnauthorized: true` for Supabase database and pooler hosts. This validates the certificate chain and hostname instead of disabling certificate checks. Set `DATABASE_CA_CERT_PATH` if a future project uses a different official CA.

Reference: https://supabase.com/docs/guides/platform/ssl-enforcement
