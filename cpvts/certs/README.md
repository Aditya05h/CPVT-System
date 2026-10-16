# Supabase public root certificate

`supabase-ca.crt` is a public CA certificate, not a private key or password.

- Source: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
- Subject: Supabase Root 2021 CA
- SHA-256 fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`
- Expires: April 26, 2031

The PostgreSQL adapter uses this certificate with `rejectUnauthorized: true`, verifying both the certificate chain and hostname. It never disables certificate verification, including when the connection URL contains an `sslmode` option. Update the certificate from Supabase's Database Settings if Supabase rotates its CA. `DATABASE_CA_CERT` can point to the replacement certificate.
