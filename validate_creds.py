"""
Validasi credentials Polymarket + info wallet
Jalankan: python3 validate_creds.py
"""
from py_clob_client.client import ClobClient
from py_clob_client.clob_types import ApiCreds
import os
from pathlib import Path
from dotenv import load_dotenv

# Load dari cuk/real1.env
env_path = Path(__file__).parent / "cuk" / "real1.env"
load_dotenv(env_path)

PRIVATE_KEY  = os.getenv("POLY_PRIVATE_KEY", "")
API_KEY      = os.getenv("POLY_API_KEY", "")
API_SECRET   = os.getenv("POLY_SECRET", "")
API_PASS     = os.getenv("POLY_PASSPHRASE", "")

print("=== Polymarket Credential Validator ===\n")

# Validasi format
errors = []
if not PRIVATE_KEY or not PRIVATE_KEY.startswith("0x") or len(PRIVATE_KEY) != 66:
    errors.append(f"POLY_PRIVATE_KEY tidak valid (len={len(PRIVATE_KEY)})")
if not API_KEY:
    errors.append("POLY_API_KEY kosong")
if not API_SECRET:
    errors.append("POLY_SECRET kosong")
if not API_PASS:
    errors.append("POLY_PASSPHRASE kosong")

if errors:
    for e in errors:
        print(f"  ERROR: {e}")
    exit(1)

print(f"  POLY_PRIVATE_KEY : {PRIVATE_KEY[:6]}...{PRIVATE_KEY[-4:]} ({len(PRIVATE_KEY)} chars) ✓")
print(f"  POLY_API_KEY     : {API_KEY[:8]}...  ✓")
print(f"  POLY_SECRET      : {API_SECRET[:8]}...  ✓")
print(f"  POLY_PASSPHRASE  : {API_PASS[:8]}...  ✓")
print()

# Connect dengan API credentials
print("Connecting ke Polymarket CLOB...")
try:
    creds = ApiCreds(
        api_key=API_KEY,
        api_secret=API_SECRET,
        api_passphrase=API_PASS,
    )
    client = ClobClient(
        host="https://clob.polymarket.com",
        key=PRIVATE_KEY,
        chain_id=137,
        creds=creds,
    )

    # Get wallet address dari private key
    from eth_account import Account
    account = Account.from_key(PRIVATE_KEY)
    wallet_address = account.address

    print(f"\n=== Info Wallet ===")
    print(f"  Wallet Address   : {wallet_address}")
    print(f"  Polymarket URL   : https://polymarket.com/profile/{wallet_address}")

    # Cek koneksi ke CLOB - ambil open orders (akan error jika creds salah)
    try:
        orders = client.get_orders()
        print(f"\n  Koneksi CLOB     : SUKSES ✓")
        print(f"  Open Orders      : {len(orders) if orders else 0}")
    except Exception as e:
        err = str(e)
        if "401" in err or "unauthorized" in err.lower() or "forbidden" in err.lower():
            print(f"\n  Koneksi CLOB     : GAGAL - API credentials salah (401 Unauthorized)")
            print(f"  Coba jalankan gen_api_key.py lagi untuk generate credentials baru")
        else:
            print(f"\n  Koneksi CLOB     : GAGAL - {err[:100]}")

except Exception as e:
    print(f"\nERROR: {e}")
    exit(1)
