TEST ONLY key pair used by the local PayPal mock to sign fake webhooks (SHA256withRSA),
so the same offline verification code path runs in mock mode. It protects nothing and is
never used with real PayPal. Regenerate with:

    openssl req -x509 -newkey rsa:2048 -nodes -keyout mock-signing-key.pem -out mock-signing-cert.pem -days 3650 -subj "/CN=PartDrop mock PayPal webhook signer (TEST ONLY)"
