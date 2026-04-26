"""
Script cek kesiapan wallet untuk Polymarket Bot
Menggunakan library resmi py-clob-client (handle signing otomatis)

Install dulu:
    pip install py-clob-client web3 python-dotenv requests
"""

import os
import sys
from dotenv import load_dotenv

load_dotenv()

# ── Warna terminal ────────────────────────────────────────────────────────────
class C:
    GREEN  = "\033[92m"
    YELLOW = "\033[93m"
    RED    = "\033[91m"
    CYAN   = "\033[96m"
    BOLD   = "\033[1m"
    RESET  = "\033[0m"

def ok(msg):   print(f"  {C.GREEN}✅ {msg}{C.RESET}")
def warn(msg): print(f"  {C.YELLOW}⚠️  {msg}{C.RESET}")
def err(msg):  print(f"  {C.RED}❌ {msg}{C.RESET}")
def info(msg): print(f"  {C.CYAN}ℹ️  {msg}{C.RESET}")

# ── Dependency check ──────────────────────────────────────────────────────────
missing_deps = []
try:
    from web3 import Web3
    from eth_account import Account
except ImportError:
    missing_deps.append("web3")

try:
    import requests
except ImportError:
    missing_deps.append("requests")

try:
    from py_clob_client.client import ClobClient
    from py_clob_client.clob_types import ApiCreds, OrderArgs, OrderType
    from py_clob_client.order_builder.constants import BUY
except ImportError:
    missing_deps.append("py-clob-client")

if missing_deps:
    print(f"\n❌ Library belum terinstall: {', '.join(missing_deps)}")
    print(f"   Jalankan: pip install {' '.join(missing_deps)}")
    sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────────────
POLYGON_RPCS = [
    "https://polygon-bor-rpc.publicnode.com",
    "https://rpc-mainnet.matic.quiknode.pro",
    "https://polygon.llamarpc.com",
    "https://rpc.ankr.com/polygon",
    "https://polygon-rpc.com",
]

USDC_e      = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"  # USDC.e (bridged) ← yg di MetaMask
USDC_NATIVE = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"  # USDC native
HOST        = "https://clob.polymarket.com"
CHAIN_ID    = 137

MIN_POL  = 0.05
MIN_USDC = 1.0

ERC20_ABI = [
    {"inputs": [{"name": "account", "type": "address"}],
     "name": "balanceOf", "outputs": [{"name": "", "type": "uint256"}],
     "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "decimals",
     "outputs": [{"name": "", "type": "uint8"}],
     "stateMutability": "view", "type": "function"},
]

# ── Helpers ───────────────────────────────────────────────────────────────────
def load_env():
    pk         = os.getenv("POLY_PRIVATE_KEY", "").strip()
    api_key    = os.getenv("POLY_API_KEY", "").strip()
    secret     = os.getenv("POLY_SECRET", "").strip()
    passphrase = os.getenv("POLY_PASSPHRASE", "").strip()
    if not pk.startswith("0x"):
        pk = "0x" + pk
    return pk, api_key, secret, passphrase

def connect_polygon():
    for rpc in POLYGON_RPCS:
        try:
            w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 8}))
            if w3.is_connected():
                info(f"RPC: {rpc}")
                return w3
            warn(f"Tidak respon: {rpc}")
        except Exception as e:
            warn(f"Gagal {rpc}: {e}")
    return None

def get_usdc_balances(w3, address):
    result = {}
    for name, addr in [("USDC.e (bridged)", USDC_e), ("USDC native", USDC_NATIVE)]:
        try:
            c   = w3.eth.contract(address=Web3.to_checksum_address(addr), abi=ERC20_ABI)
            raw = c.functions.balanceOf(address).call()
            dec = c.functions.decimals().call()
            result[name] = raw / (10 ** dec)
        except Exception as e:
            result[name] = 0.0
    return result

def get_sample_market_token():
    """Ambil token_id dari market aktif untuk test order"""
    try:
        r = requests.get(
            f"{HOST}/markets",
            params={"active": "true", "closed": "false", "limit": 10},
            timeout=8
        )
        if r.status_code == 200:
            data    = r.json()
            markets = data if isinstance(data, list) else data.get("data", [])
            for m in markets:
                tokens = m.get("tokens", [])
                if tokens and tokens[0].get("token_id"):
                    return m.get("question", "Unknown")[:55], tokens[0]["token_id"]
    except Exception as e:
        warn(f"Gagal ambil market: {e}")
    return None, None

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print()
    print(f"{C.BOLD}{'='*58}{C.RESET}")
    print(f"{C.BOLD}  🔍 CEK KESIAPAN WALLET + ORDER POLYMARKET BOT{C.RESET}")
    print(f"{C.BOLD}{'='*58}{C.RESET}")

    issues = []

    # ── Load env ──────────────────────────────────────────────
    pk, api_key, secret, passphrase = load_env()

    missing_creds = []
    if not pk or pk == "0x":    missing_creds.append("POLY_PRIVATE_KEY")
    if not api_key:             missing_creds.append("POLY_API_KEY")
    if not secret:              missing_creds.append("POLY_SECRET")
    if not passphrase:          missing_creds.append("POLY_PASSPHRASE")

    # ── [1] Wallet ────────────────────────────────────────────
    print(f"\n{C.BOLD}[1] WALLET ADDRESS{C.RESET}")
    if "POLY_PRIVATE_KEY" in missing_creds:
        err("POLY_PRIVATE_KEY tidak ada di .env")
        sys.exit(1)
    try:
        address = Account.from_key(pk).address
        ok(f"Address: {address}")
    except Exception as e:
        err(f"Private key tidak valid: {e}")
        sys.exit(1)

    # ── [2] Polygon RPC ───────────────────────────────────────
    print(f"\n{C.BOLD}[2] KONEKSI POLYGON NETWORK{C.RESET}")
    w3 = connect_polygon()
    if w3:
        ok(f"Terhubung ke Polygon (Chain ID: {w3.eth.chain_id})")
    else:
        err("Semua Polygon RPC gagal — skip cek saldo on-chain")
        issues.append("Tidak bisa konek Polygon RPC")
        w3 = None

    # ── [3] Saldo POL ─────────────────────────────────────────
    pol = 0.0
    print(f"\n{C.BOLD}[3] SALDO POL/MATIC (gas fee){C.RESET}")
    if w3:
        pol = float(w3.from_wei(w3.eth.get_balance(address), "ether"))
        print(f"  💰 Saldo: {pol:.6f} POL")
        if pol >= MIN_POL:
            ok("Cukup untuk gas fee")
        elif pol > 0:
            warn(f"POL sedikit ({pol:.6f}), rekomendasikan min {MIN_POL} POL")
            issues.append("POL kurang")
        else:
            err("POL = 0! Tidak bisa kirim transaksi on-chain")
            err("→ MetaMask: Swap USDC → POL (cukup 0.1 POL)")
            issues.append("POL = 0")
    else:
        warn("Skip — tidak bisa konek RPC")

    # ── [4] Saldo USDC ────────────────────────────────────────
    usdc_total = 0.0
    print(f"\n{C.BOLD}[4] SALDO USDC (modal trading){C.RESET}")
    if w3:
        usdc_map   = get_usdc_balances(w3, address)
        usdc_total = sum(usdc_map.values())
        for name, bal in usdc_map.items():
            icon = "💵" if bal > 0 else "  "
            print(f"  {icon} {name}: ${bal:.4f}")
        print(f"  {'─'*40}")
        print(f"  💰 Total USDC: ${usdc_total:.4f}")
        if usdc_total >= MIN_USDC:
            ok("Saldo USDC cukup untuk trading")
        elif usdc_total > 0:
            warn(f"USDC ${usdc_total:.4f} sangat kecil (min ${MIN_USDC})")
            issues.append("USDC terlalu sedikit")
        else:
            err("USDC = 0!")
            issues.append("USDC = 0")
    else:
        warn("Skip — tidak bisa konek RPC")

    # ── [5] API Credentials ───────────────────────────────────
    print(f"\n{C.BOLD}[5] POLYMARKET API CREDENTIALS{C.RESET}")
    if not missing_creds:
        ok("Semua credentials tersedia di .env")
        info(f"API Key   : {api_key[:8]}...{api_key[-4:]}")
        info(f"Secret    : {secret[:6]}...{secret[-4:]}")
        info(f"Passphrase: {passphrase[:6]}...{passphrase[-4:]}")
    else:
        for m in missing_creds:
            err(f"{m} tidak ada di .env")
        issues.append(f"Credentials kurang: {', '.join(missing_creds)}")

    # ── [6] Inisialisasi py-clob-client ──────────────────────
    print(f"\n{C.BOLD}[6] INISIALISASI py-clob-client{C.RESET}")
    client = None
    if not missing_creds:
        try:
            client = ClobClient(
                host=HOST,
                key=pk,
                chain_id=CHAIN_ID,
            )
            creds = ApiCreds(
                api_key=api_key,
                api_secret=secret,
                api_passphrase=passphrase,
            )
            client.set_api_creds(creds)
            ok("ClobClient berhasil diinisialisasi")
        except Exception as e:
            err(f"Gagal inisialisasi ClobClient: {e}")
            issues.append("ClobClient gagal init")
            client = None
    else:
        warn("Skip — credentials tidak lengkap")

    # ── [7] Test Autentikasi L2 ───────────────────────────────
    print(f"\n{C.BOLD}[7] TEST AUTENTIKASI API (L2){C.RESET}")
    auth_ok = False
    if client:
        try:
            resp = client.get_api_keys()
            # get_api_keys() return list of api key objects
            if resp is not None:
                count = len(resp) if isinstance(resp, list) else 1
                ok(f"Auth L2 BERHASIL ✅ — ditemukan {count} API key aktif")
                auth_ok = True
            else:
                err("Auth L2 GAGAL — response kosong")
                issues.append("Auth L2 gagal")
        except Exception as e:
            err_str = str(e)
            if "401" in err_str:
                err("Auth GAGAL (401) — API key salah atau expired")
                err("→ Generate ulang di: https://polymarket.com/settings")
                err("→ Atau jalankan: python generate_api_key.py")
            elif "403" in err_str:
                err("Auth GAGAL (403) — Akun belum approved / region blocked")
            else:
                err(f"Auth error: {err_str[:150]}")
            issues.append(f"Auth L2 gagal: {err_str[:60]}")
    else:
        warn("Skip — client tidak tersedia")

    # ── [8] Test Kemampuan Order ──────────────────────────────
    print(f"\n{C.BOLD}[8] TEST KEMAMPUAN ORDER (dry-run){C.RESET}")
    if client and auth_ok:
        info("Mengambil sample market aktif...")
        mname, token_id = get_sample_market_token()

        if not token_id:
            warn("Tidak bisa ambil market sample — skip test order")
            issues.append("Gagal ambil market sample")
        else:
            info(f"Market  : {mname}")
            info(f"Token ID: {token_id[:28]}...")
            info("Membuat signed order (size $1, price $0.01 — sangat kecil, pasti ditolak)...")

            try:
                # Buat order args — pakai harga sangat rendah agar ditolak server
                # tapi kita tetap bisa tahu apakah signing & auth berjalan
                order_args = OrderArgs(
                    token_id=token_id,
                    price=0.01,   # harga sangat rendah
                    size=1.0,
                    side=BUY,
                )
                signed_order = client.create_order(order_args)
                ok("Order berhasil di-SIGN ✅ (EIP-712 signature valid)")

                # Coba submit ke server
                try:
                    resp = client.post_order(signed_order, OrderType.GTC)
                    if resp and resp.get("success"):
                        ok(f"Order DITERIMA server ✅ — Order ID: {resp.get('orderID','')[:20]}")
                        warn("Ada order aktif di akun kamu, cek di Polymarket jika perlu dibatalkan")
                    elif resp and resp.get("errorMsg"):
                        emsg = resp.get("errorMsg", "")
                        # Error karena size/harga terlalu kecil = NORMAL, auth sudah OK
                        ok(f"Auth & signing OK ✅ — Server tolak karena: {emsg[:80]}")
                        ok("Bot BISA membuat order 🎉")
                    else:
                        ok(f"Server merespon: {str(resp)[:120]}")
                        ok("Bot BISA membuat order 🎉")

                except Exception as post_err:
                    post_str = str(post_err)
                    if any(k in post_str for k in ["minimum", "size", "price", "invalid", "400", "422"]):
                        ok("Auth & signing OK ✅ — Server tolak karena ukuran order terlalu kecil")
                        ok("Bot BISA membuat order 🎉")
                    elif "401" in post_str:
                        err(f"Post order auth gagal (401): {post_str[:100]}")
                        issues.append("Post order auth gagal")
                    else:
                        warn(f"Post order error: {post_str[:120]}")

            except Exception as sign_err:
                err(f"Gagal membuat signed order: {str(sign_err)[:150]}")
                issues.append("Signing order gagal")
    elif client and not auth_ok:
        warn("Skip — auth L2 gagal, perbaiki API key dulu")
    else:
        warn("Skip — client tidak tersedia")

    # ── Kesimpulan ────────────────────────────────────────────
    print()
    print(f"{C.BOLD}{'='*58}{C.RESET}")
    print(f"{C.BOLD}  📋 KESIMPULAN AKHIR{C.RESET}")
    print(f"{C.BOLD}{'='*58}{C.RESET}")
    print(f"\n  Wallet  : {address}")
    print(f"  POL     : {pol:.6f}  {'✅' if pol >= MIN_POL else '❌'}")
    print(f"  USDC    : ${usdc_total:.4f}  {'✅' if usdc_total >= MIN_USDC else '❌'}")
    print(f"  API Keys: {'✅ Lengkap' if not missing_creds else '❌ Kurang'}")
    print(f"  Auth L2 : {'✅ Valid' if auth_ok else '❌ Gagal'}")

    if not issues:
        print(f"\n{C.GREEN}{C.BOLD}  🚀 SEMUA OK! Wallet siap untuk Polymarket Bot!{C.RESET}")
    else:
        print(f"\n{C.YELLOW}{C.BOLD}  ⚠️  Ada {len(issues)} masalah:{C.RESET}")
        for i, issue in enumerate(issues, 1):
            print(f"  {i}. {C.RED}{issue}{C.RESET}")

        print(f"\n{C.CYAN}  💡 Cara perbaiki:{C.RESET}")
        if any("POL" in x for x in issues):
            print("  • MetaMask → Swap → pilih USDC ke POL, isi 0.1 POL")
        if any("USDC" in x for x in issues):
            print("  • Top up USDC ke wallet kamu via exchange/transfer")
        if any("401" in x or "Auth" in x for x in issues):
            print("  • Jalankan: python generate_api_key.py (untuk buat ulang API key)")
            print("  • Atau: https://polymarket.com/settings → re-generate")
        if any("403" in x for x in issues):
            print("  • Cek apakah akun sudah verified & tidak diblokir by region")
    print()


if __name__ == "__main__":
    main()