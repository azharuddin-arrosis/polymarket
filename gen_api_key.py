"""
Generate Polymarket CLOB API credentials (API_KEY, SECRET, PASSPHRASE)
Jalankan: python gen_api_key.py
"""
from py_clob_client.client import ClobClient
from py_clob_client.clob_types import ApiCreds
import os
from pathlib import Path
from dotenv import load_dotenv

# Load dari envs/real1.env
env_path = Path(__file__).parent / "cuk" / "real1.env"
load_dotenv(env_path)

PRIVATE_KEY = os.getenv("POLY_PRIVATE_KEY", "")

if not PRIVATE_KEY:
    print("ERROR: POLY_PRIVATE_KEY kosong di cuk/real1.env")
    exit(1)

if not PRIVATE_KEY.startswith("0x") or len(PRIVATE_KEY) != 66:
    print(f"ERROR: POLY_PRIVATE_KEY tidak valid.")
    print(f"  Panjang sekarang : {len(PRIVATE_KEY)} karakter")
    print(f"  Harus            : 66 karakter (0x + 64 hex)")
    exit(1)

print(f"Menggunakan private key: {PRIVATE_KEY[:6]}...{PRIVATE_KEY[-4:]}")
print("Connecting ke Polymarket CLOB...")

client = ClobClient(
    host="https://clob.polymarket.com",
    key=PRIVATE_KEY,
    chain_id=137,  # Polygon Mainnet
)

creds = client.create_api_key()

print("\n=== BERHASIL! Salin baris berikut ke envs/real1.env ===\n")
print(f"POLY_API_KEY={creds.api_key}")
print(f"POLY_SECRET={creds.api_secret}")
print(f"POLY_PASSPHRASE={creds.api_passphrase}")
print("\n=======================================================")
