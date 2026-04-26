"""
Generate / derive ulang API Key Polymarket dari Private Key
Jalankan ini jika API key di .env kamu expired atau salah.

Hasil akan otomatis ditulis ke .env
"""

import os
import sys
from dotenv import load_dotenv, set_key

load_dotenv()

try:
    from py_clob_client.client import ClobClient
except ImportError:
    print("❌ Jalankan dulu: pip install py-clob-client python-dotenv")
    sys.exit(1)

HOST     = "https://clob.polymarket.com"
CHAIN_ID = 137
ENV_FILE = ".env"

pk = os.getenv("POLY_PRIVATE_KEY", "").strip()
if not pk:
    print("❌ POLY_PRIVATE_KEY tidak ada di .env")
    sys.exit(1)

if not pk.startswith("0x"):
    pk = "0x" + pk

print("\n🔑 Generate API Key Polymarket...")
print("   Menggunakan private key dari .env\n")

try:
    client = ClobClient(host=HOST, key=pk, chain_id=CHAIN_ID)
    creds  = client.create_or_derive_api_creds()

    api_key    = creds.api_key
    secret     = creds.api_secret
    passphrase = creds.api_passphrase

    print(f"✅ Berhasil generate API credentials!")
    print(f"\n  API Key   : {api_key}")
    print(f"  Secret    : {secret}")
    print(f"  Passphrase: {passphrase}")

    # Tulis ke .env
    set_key(ENV_FILE, "POLY_API_KEY",    api_key)
    set_key(ENV_FILE, "POLY_SECRET",     secret)
    set_key(ENV_FILE, "POLY_PASSPHRASE", passphrase)

    print(f"\n✅ Credentials sudah disimpan ke {ENV_FILE}")
    print("   Sekarang jalankan: python check_polymarket_wallet.py\n")

except Exception as e:
    print(f"❌ Gagal generate API key: {e}")
    print("   Pastikan private key benar dan wallet sudah terdaftar di Polymarket")
    sys.exit(1)