/**
 * Confirmed USDT (TRC20) transfers to a wallet, from TronGrid's public API. Without TRONGRID_API_KEY it
 * allows about one request a second, which is plenty for a check every 30 seconds.
 */

import axios from "axios";
import { USDT_TRC20_CONTRACT, type Transfer } from "@/services/payments/logic";

export async function incomingTransfers(address: string, since: number): Promise<Transfer[]> {
  const key = process.env.TRONGRID_API_KEY?.trim();
  const { data } = await axios.get<{
    data?: Array<{ transaction_id: string; value: string; block_timestamp: number; to: string; token_info?: { address?: string } }>;
    Error?: string;
  }>(`https://api.trongrid.io/v1/accounts/${address}/transactions/trc20`, {
    params: { only_to: true, only_confirmed: true, contract_address: USDT_TRC20_CONTRACT, min_timestamp: since, limit: 200, order_by: "block_timestamp,asc" },
    headers: key ? { "TRON-PRO-API-KEY": key } : undefined,
    timeout: 15_000,
  });
  if (data.Error) throw new Error(`TronGrid: ${data.Error.slice(0, 120)}`);
  return (data.data ?? []).map((t) => ({
    txId: t.transaction_id,
    value: Number(t.value),
    timestamp: t.block_timestamp,
    to: t.to,
    contract: t.token_info?.address ?? "",
  }));
}
