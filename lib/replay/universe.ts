/** Archive-only research universe. This is deliberately not the Phase A1 live universe. */
export const ARCHIVE_SYMBOLS = [
  "AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","AMD","NFLX",
  "COST","PLTR","ADBE","CSCO","PEP","INTC","QCOM","TXN","AMAT","MU",
  "LRCX","KLAC","ARM","SMCI","MRVL","PANW","CRWD","SNPS","CDNS","MSTR",
  "COIN","HOOD","IBIT","MARA","RIOT","JPM","BAC","WFC","GS","MS",
  "C","SCHW","AXP","V","MA","PYPL","SOFI","BLK","BX","KKR",
  "UNH","LLY","JNJ","ABBV","MRK","PFE","TMO","ABT","ISRG","AMGN",
  "GILD","VRTX","REGN","CVS","CI","HUM","ELV","DHR","SYK","BSX",
  "WMT","HD","LOW","TGT","CROX","NKE","SBUX","MCD","CMG","YUM",
  "ORLY","AZO","ROST","TJX","LULU","DIS","CMCSA","T","VZ","TMUS",
  "UBER","ABNB","BKNG","DASH","RCL","CCL","DAL","UAL","AAL","MAR",
  "XOM","CVX","COP","OXY","SLB","EOG","MPC","VLO","PSX","HAL",
  "CAT","DE","GE","HON","RTX","LMT","BA","UPS","FDX","UNP",
  "LIN","FCX","NUE","STLD","CLF","AA","DOW","DD","APD","SHW",
  "NEE","DUK","SO","AEP","CEG","VST","ETR","EXC","SRE","XEL",
  "CRM","NOW","ORCL","IBM","INTU","SHOP","SNOW","NET","DDOG","MDB",
  "ZS","OKTA","TEAM","APP","RBLX","TTD","ROKU","SPOT","PINS","SNAP",
  "SPY","QQQ","IWM","DIA","SMH","XLK","XLF","XLE","XLV","XLY",
  "XLP","XLI","XLU","XLB","XLRE","XLC","KRE","IBB","XBI","ARKK",
  "GLD","SLV","TLT","HYG","USO","UNG","GDX","EEM","FXI","EWZ",
] as const;

if (ARCHIVE_SYMBOLS.length < 150 || ARCHIVE_SYMBOLS.length > 200) {
  throw new Error(`Archive universe must contain 150-200 symbols; got ${ARCHIVE_SYMBOLS.length}.`);
}
