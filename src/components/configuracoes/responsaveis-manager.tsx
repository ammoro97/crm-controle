"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { getResponsavelImpact, transferResponsavelVinculos } from "@/lib/responsaveis-relations";
import {
  type ResponsavelRecord,
  type ResponsavelTipo,
  addResponsavel,
  removeResponsavel,
  syncAllUnlinkedResponsaveis,
  syncResponsavelAuthLinkExplicit,
  updateResponsavel,
  useResponsaveis,
  useResponsaveisRecords,
} from "@/lib/responsaveis-store";

export function ResponsaveisManager() {
  const responsaveisRecords = useResponsaveisRecords();
  const responsaveis = useResponsaveis(false);

  const [novoResponsavel, setNovoResponsavel] = useState("");
  const [novoResponsavelTipo, setNovoResponsavelTipo] = useState<ResponsavelTipo>("vendedor");
  const [novoResponsavelEmail, setNovoResponsavelEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const autoSyncedRef = useRef(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncResults, setSyncResults] = useState<Record<string, { linked: boolean; message?: string }>>({});

  useEffect(() => {
    if (autoSyncedRef.current) return;
    autoSyncedRef.current = true;
    void syncAllUnlinkedResponsaveis();
  }, []);

  const [editingResponsavelId, setEditingResponsavelId] = useState<string | null>(null);
  const [editingNome, setEditingNome] = useState("");
  const [editingTipo, setEditingTipo] = useState<ResponsavelTipo>("vendedor");
  const [editingEmail, setEditingEmail] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<ResponsavelRecord | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [deleteErro, setDeleteErro] = useState<string | null>(null);

  const deleteImpact = useMemo(() => {
    if (!deleteTarget) return { leadCount: 0, meetingCount: 0, total: 0 };
    return getResponsavelImpact(deleteTarget.nome);
  }, [deleteTarget]);

  const transferOptions = useMemo(
    () => responsaveisRecords.filter((item) => item.id !== deleteTarget?.id),
    [responsaveisRecords, deleteTarget?.id],
  );

  const handleAdd = async () => {
    const nextNome = novoResponsavel.trim();
    const nextEmail = novoResponsavelEmail.trim().toLowerCase();

    if (!nextNome) {
      setErro("Informe um nome para continuar.");
      return;
    }

    const duplicatedName = responsaveis.some((item) => item.toLowerCase() === nextNome.toLowerCase());
    if (duplicatedName) {
      setErro("Este responsavel ja esta cadastrado.");
      return;
    }

    if (nextEmail) {
      const duplicatedEmail = responsaveisRecords.some((item) => (item.email || "").toLowerCase() === nextEmail);
      if (duplicatedEmail) {
        setErro("Ja existe um responsavel com este e-mail.");
        return;
      }
    }

    try {
      await addResponsavel({ nome: nextNome, tipo: novoResponsavelTipo, email: nextEmail });
      setNovoResponsavel("");
      setNovoResponsavelTipo("vendedor");
      setNovoResponsavelEmail("");
      setErro(null);
    } catch (errorInstance) {
      setErro(errorInstance instanceof Error ? errorInstance.message : "Nao foi possivel adicionar responsavel.");
    }
  };

  const openEdit = (record: ResponsavelRecord) => {
    setEditingResponsavelId(record.id);
    setEditingNome(record.nome);
    setEditingTipo(record.tipo);
    setEditingEmail(record.email || "");
    setErro(null);
  };

  const cancelEdit = () => {
    setEditingResponsavelId(null);
    setEditingNome("");
    setEditingTipo("vendedor");
    setEditingEmail("");
    setErro(null);
  };

  const saveEdit = async () => {
    if (!editingResponsavelId) return;
    const nextNome = editingNome.trim();
    const nextEmail = editingEmail.trim().toLowerCase();

    if (!nextNome) {
      setErro("Informe um nome para continuar.");
      return;
    }

    const duplicated = responsaveisRecords.some(
      (item) => item.id !== editingResponsavelId && item.nome.toLowerCase() === nextNome.toLowerCase(),
    );
    if (duplicated) {
      setErro("Ja existe um responsavel com este nome.");
      return;
    }

    if (nextEmail) {
      const duplicatedEmail = responsaveisRecords.some(
        (item) => item.id !== editingResponsavelId && (item.email || "").toLowerCase() === nextEmail,
      );
      if (duplicatedEmail) {
        setErro("Ja existe um responsavel com este e-mail.");
        return;
      }
    }

    try {
      await updateResponsavel(editingResponsavelId, { nome: nextNome, tipo: editingTipo, email: nextEmail });
      cancelEdit();
    } catch (errorInstance) {
      setErro(errorInstance instanceof Error ? errorInstance.message : "Nao foi possivel editar responsavel.");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    if (deleteImpact.total > 0) {
      if (responsaveis.length === 1) {
        setDeleteErro(
          "Nao e possivel excluir este responsavel porque ele e o ultimo cadastrado e existem itens vinculados a ele.",
        );
        return;
      }
      if (!transferTo) {
        setDeleteErro("Selecione para quem os vinculos serao transferidos.");
        return;
      }

      transferResponsavelVinculos(deleteTarget.nome, transferTo);
    }

    try {
      await removeResponsavel(deleteTarget.id);
      setDeleteTarget(null);
      setTransferTo("");
      setDeleteErro(null);
    } catch (errorInstance) {
      setDeleteErro(errorInstance instanceof Error ? errorInstance.message : "Nao foi possivel excluir responsavel.");
    }
  };

  return (
    <>
      <div className="space-y-4">
        <article className="rounded-xl border border-border bg-slate-900/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Novo responsavel</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              className="field"
              placeholder="Nome do responsavel"
              value={novoResponsavel}
              onChange={(event) => setNovoResponsavel(event.target.value)}
            />
            <input
              className="field"
              type="email"
              placeholder="E-mail do login (opcional)"
              value={novoResponsavelEmail}
              onChange={(event) => setNovoResponsavelEmail(event.target.value)}
            />
            <select
              className="field sm:max-w-[180px]"
              value={novoResponsavelTipo}
              onChange={(event) => setNovoResponsavelTipo(event.target.value as ResponsavelTipo)}
            >
              <option value="vendedor">Vendedor</option>
              <option value="gestor">Gestor</option>
            </select>
            <button type="button" className="btn-primary whitespace-nowrap" onClick={() => void handleAdd()}>
              Adicionar
            </button>
          </div>
          {erro ? <p className="mt-2 text-xs text-rose-300">{erro}</p> : null}
        </article>

        <article className="rounded-xl border border-border bg-slate-900/50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Responsaveis cadastrados</p>
            <span className="text-xs text-slate-400">{responsaveisRecords.length}</span>
          </div>

          {responsaveisRecords.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhum responsavel cadastrado.</p>
          ) : (
            <div className="space-y-2">
              {responsaveisRecords.map((record) => (
                <div key={record.id} className="rounded-lg border border-border bg-slate-950/40 px-3 py-2">
                  {editingResponsavelId === record.id ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input className="field" value={editingNome} onChange={(event) => setEditingNome(event.target.value)} />
                      <input
                        className="field"
                        type="email"
                        placeholder="E-mail do login (opcional)"
                        value={editingEmail}
                        onChange={(event) => setEditingEmail(event.target.value)}
                      />
                      <select
                        className="field sm:max-w-[180px]"
                        value={editingTipo}
                        onChange={(event) => setEditingTipo(event.target.value as ResponsavelTipo)}
                      >
                        <option value="vendedor">Vendedor</option>
                        <option value="gestor">Gestor</option>
                      </select>
                      <button type="button" className="btn-primary whitespace-nowrap" onClick={() => void saveEdit()}>
                        Salvar
                      </button>
                      <button type="button" className="btn-ghost whitespace-nowrap" onClick={cancelEdit}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div>
                          <span className="text-sm text-slate-100">{record.nome}</span>
                          {record.email ? <p className="text-xs text-slate-400">{record.email}</p> : null}
                          <div className="flex items-center gap-2">
                            <p className={`text-[11px] ${record.authUserId ? "text-emerald-300" : syncResults[record.id]?.linked === false ? "text-rose-300" : "text-amber-300"}`}>
                              {record.authUserId
                                ? "Login autenticado vinculado"
                                : syncResults[record.id]?.linked === false
                                  ? (syncResults[record.id]?.message || "Login nao encontrado para este e-mail")
                                  : "Sem login autenticado vinculado"}
                            </p>
                            {!record.authUserId && record.email ? (
                              <button
                                type="button"
                                disabled={syncingId === record.id}
                                className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/10 disabled:opacity-50 transition"
                                onClick={async () => {
                                  setSyncingId(record.id);
                                  const result = await syncResponsavelAuthLinkExplicit(record.id);
                                  setSyncResults((prev) => ({ ...prev, [record.id]: result }));
                                  setSyncingId(null);
                                }}
                              >
                                {syncingId === record.id ? "Vinculando..." : "Vincular"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <span className="rounded-md border border-slate-600 bg-slate-800/70 px-2 py-0.5 text-[11px] font-semibold text-slate-200">
                          {record.tipo === "gestor" ? "Gestor" : "Vendedor"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
                          onClick={() => openEdit(record)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-rose-500/40 px-2 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10"
                          onClick={() => {
                            setDeleteTarget(record);
                            setTransferTo("");
                            setDeleteErro(null);
                          }}
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <Modal title="Excluir responsavel" open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        {deleteTarget ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-200">
              Voce esta prestes a excluir o responsavel:{" "}
              <span className="font-semibold text-slate-100">{deleteTarget.nome}</span>
            </p>

            {deleteImpact.total > 0 ? (
              <div className="space-y-3 rounded-lg border border-border bg-slate-900/50 p-3 text-sm text-slate-300">
                <p>Este responsavel possui itens vinculados e eles precisam ser transferidos para outro responsavel.</p>
                <p className="text-xs text-slate-400">
                  Leads: {deleteImpact.leadCount} | Agendamentos: {deleteImpact.meetingCount}
                </p>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Transferir vinculos para
                  </span>
                  <select className="field" value={transferTo} onChange={(event) => setTransferTo(event.target.value)}>
                    <option value="">Selecione</option>
                    {transferOptions.map((item) => (
                      <option key={item.id} value={item.nome}>
                        {item.nome}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}

            {deleteErro ? <p className="text-xs text-rose-300">{deleteErro}</p> : null}

            <div className="flex items-center gap-2">
              <button type="button" className="btn-ghost" onClick={() => setDeleteTarget(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-500"
                onClick={() => void confirmDelete()}
              >
                Confirmar exclusao
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
