"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Input } from "@/components/ui";
import { errMsg } from "@/lib/run-status";
import type { TwoFaEnrollment } from "@/lib/types";

export default function TwoFactorPage() {
  const [code, setCode] = useState("");

  const enroll = useMutation({ mutationFn: () => api.post<TwoFaEnrollment>("/admin/2fa/enroll", {}) });
  const verify = useMutation({
    mutationFn: () => api.post<{ enabled: boolean }>("/admin/2fa/verify", { code: code.trim() }),
  });

  const data = enroll.data;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Two factor authentication</h1>
        <p className="mt-1 text-sm text-fg-2">
          Enroll an authenticator app, then confirm with a code. Enrollment is not active until you confirm.
          Sign in does not ask for the code yet; that step is still to be built.
        </p>
      </header>

      {!data && (
        <Card className="flex items-center justify-between p-6">
          <p className="text-sm text-fg-2">Starting enrollment replaces any unconfirmed attempt.</p>
          <Button loading={enroll.isPending} onClick={() => enroll.mutate()}>Start enrollment</Button>
        </Card>
      )}
      {enroll.isError && <p className="text-sm text-danger">{errMsg(enroll.error)}</p>}

      {data && !verify.data?.enabled && (
        <Card className="space-y-5 p-6">
          <div className="flex flex-col gap-6 sm:flex-row">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={data.qrDataUrl} alt="Authenticator QR code" className="h-44 w-44 rounded-lg bg-white p-2" />
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-fg-2">Secret (shown once)</div>
                <code className="break-all font-mono text-xs">{data.secret}</code>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-fg-2">Recovery codes (store offline)</div>
                <ul className="mt-1 grid grid-cols-2 gap-x-6 font-mono text-xs">
                  {data.recoveryCodes.map((c) => <li key={c}>{c}</li>)}
                </ul>
              </div>
            </div>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="mb-2 block text-xs uppercase tracking-wide text-fg-2">Code from your app</label>
              <Input inputMode="numeric" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
            </div>
            <Button loading={verify.isPending} disabled={code.trim().length < 6} onClick={() => verify.mutate()}>
              Confirm
            </Button>
          </div>
          {verify.isError && <p className="text-sm text-danger">{errMsg(verify.error)}</p>}
        </Card>
      )}

      {verify.data?.enabled && (
        <Card className="p-6 text-sm text-success">Two factor authentication is on for your account.</Card>
      )}
    </div>
  );
}
