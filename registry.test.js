import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initRegistry } from "./registry.js";

function createFormElements(root = document) {
  const form = root.createElement("form");
  form.className = "notify-form";

  const nomeEl = root.createElement("input");
  nomeEl.id = "nome";
  nomeEl.name = "nome";
  const emailEl = root.createElement("input");
  emailEl.id = "email";
  emailEl.name = "email";
  emailEl.type = "email";

  const submitBtn = root.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "submit-btn";

  const statusEl = root.createElement("span");
  statusEl.className = "form-status";

  form.appendChild(nomeEl);
  form.appendChild(emailEl);
  form.appendChild(submitBtn);
  form.appendChild(statusEl);

  const modal = root.createElement("div");
  modal.id = "registry-modal";
  modal.hidden = true;
  const modalMsg = root.createElement("div");
  modalMsg.id = "registry-modal-message";
  const modalClose = root.createElement("button");
  modalClose.id = "registry-modal-close";
  const backdrop = root.createElement("div");
  backdrop.setAttribute("data-modal-backdrop", "true");
  modal.appendChild(backdrop);
  modal.appendChild(modalMsg);
  modal.appendChild(modalClose);

  root.body.appendChild(form);
  root.body.appendChild(modal);

  return { form, nomeEl, emailEl, submitBtn, statusEl, modal, modalMsg, modalClose, backdrop };
}

describe("initRegistry", () => {
  let fetchMock;

  beforeEach(() => {
    document.body.innerHTML = "";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("não faz nada quando não existe .notify-form", () => {
    expect(() => initRegistry(document)).not.toThrow();
  });

  it("setStatus não quebra quando não existe .form-status", async () => {
    const form = document.createElement("form");
    form.className = "notify-form";
    const nome = document.createElement("input");
    nome.id = "nome";
    const email = document.createElement("input");
    email.id = "email";
    const btn = document.createElement("button");
    btn.type = "submit";
    form.appendChild(nome);
    form.appendChild(email);
    form.appendChild(btn);
    document.body.appendChild(form);

    const alertSpy = vi.spyOn(document.defaultView, "alert").mockImplementation(() => {});
    initRegistry(document);
    nome.value = "A";
    email.value = "a@b.com";
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });

    form.requestSubmit();
    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalled());
    alertSpy.mockRestore();
  });

  it("validação: nome e email vazios exibem erro no status", () => {
    const { form, statusEl } = createFormElements();
    initRegistry(document);

    form.requestSubmit();

    expect(statusEl.textContent).toBe("Preencha nome e e-mail.");
    expect(statusEl.dataset.kind).toBe("error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("envia fetch e abre modal em sucesso", async () => {
    const { form, nomeEl, emailEl, modal, modalMsg } = createFormElements();
    initRegistry(document);

    nomeEl.value = "Maria";
    emailEl.value = "maria@test.com";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    form.requestSubmit();

    await vi.waitFor(() => {
      expect(modal.hidden).toBe(false);
      expect(modalMsg.textContent).toContain("Maria");
      expect(modalMsg.textContent).toContain("confirmado");
    });
  });

  it("alreadyRegistered exibe mensagem de e-mail já cadastrado", async () => {
    const { form, nomeEl, emailEl, modalMsg } = createFormElements();
    initRegistry(document);

    nomeEl.value = "João";
    emailEl.value = "joao@test.com";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true, alreadyRegistered: true }),
    });

    form.requestSubmit();

    await vi.waitFor(() => {
      expect(modalMsg.textContent).toContain("ja esta cadastrado");
    });
  });

  it("erro na resposta exibe mensagem no status", async () => {
    const { form, nomeEl, emailEl, statusEl } = createFormElements();
    initRegistry(document);

    nomeEl.value = "Test";
    emailEl.value = "test@test.com";
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ ok: false, error: "Erro no servidor" }),
    });

    form.requestSubmit();

    await vi.waitFor(() => {
      expect(statusEl.textContent).toBe("Erro no servidor");
      expect(statusEl.dataset.kind).toBe("error");
    });
  });

  it("fetch rejeitada exibe mensagem genérica", async () => {
    const { form, nomeEl, emailEl, statusEl } = createFormElements();
    initRegistry(document);

    nomeEl.value = "Test";
    emailEl.value = "test@test.com";
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    form.requestSubmit();

    await vi.waitFor(() => {
      expect(statusEl.textContent).toMatch(/Network error|Erro ao enviar/);
      expect(statusEl.dataset.kind).toBe("error");
    });
  });

  it("resposta sem ok exibe erro", async () => {
    const { form, nomeEl, emailEl, statusEl } = createFormElements();
    initRegistry(document);

    nomeEl.value = "Test";
    emailEl.value = "test@test.com";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: false }),
    });

    form.requestSubmit();

    await vi.waitFor(() => {
      expect(statusEl.dataset.kind).toBe("error");
    });
  });

  it("closeModal ao clicar no backdrop", async () => {
    const { form, nomeEl, emailEl, modal, backdrop } = createFormElements();
    initRegistry(document);

    nomeEl.value = "X";
    emailEl.value = "x@x.com";
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
    form.requestSubmit();
    await vi.waitFor(() => expect(modal.hidden).toBe(false));

    backdrop.click();
    expect(modal.hidden).toBe(true);
  });

  it("closeModal ao clicar no botão fechar", async () => {
    const { form, nomeEl, emailEl, modal, modalClose } = createFormElements();
    initRegistry(document);

    nomeEl.value = "X";
    emailEl.value = "x@x.com";
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
    form.requestSubmit();
    await vi.waitFor(() => expect(modal.hidden).toBe(false));

    modalClose.click();
    expect(modal.hidden).toBe(true);
  });

  it("closeModal ao pressionar Escape", async () => {
    const { form, nomeEl, emailEl, modal } = createFormElements();
    initRegistry(document);

    nomeEl.value = "X";
    emailEl.value = "x@x.com";
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
    form.requestSubmit();
    await vi.waitFor(() => expect(modal.hidden).toBe(false));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(modal.hidden).toBe(true);
  });

  it("Escape não fecha quando modal já está escondido", () => {
    const { modal } = createFormElements();
    initRegistry(document);
    modal.hidden = true;

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(modal.hidden).toBe(true);
  });

  it("closeModal restaura foco no elemento anterior quando lastFocused tem focus()", async () => {
    const { form, nomeEl, emailEl, modal, modalClose } = createFormElements();
    initRegistry(document);
    nomeEl.focus();
    nomeEl.value = "Foco";
    emailEl.value = "foco@f.com";
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
    form.requestSubmit();
    await vi.waitFor(() => expect(modal.hidden).toBe(false));

    const focusSpy = vi.spyOn(nomeEl, "focus").mockImplementation(() => {});
    modalClose.click();
    expect(focusSpy).toHaveBeenCalled();
    focusSpy.mockRestore();
  });

  it("openModal fallback chama alert quando modal não existe", async () => {
    const form = document.createElement("form");
    form.className = "notify-form";
    const nomeEl = document.createElement("input");
    nomeEl.id = "nome";
    const emailEl = document.createElement("input");
    emailEl.id = "email";
    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "submit-btn";
    const statusEl = document.createElement("span");
    statusEl.className = "form-status";
    form.append(nomeEl, emailEl, submitBtn, statusEl);
    document.body.appendChild(form);
    // Sem modal

    const alertSpy = vi.spyOn(document.defaultView, "alert").mockImplementation(() => {});
    initRegistry(document);

    nomeEl.value = "Fallback";
    emailEl.value = "f@f.com";
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
    form.requestSubmit();

    await vi.waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("Fallback"));
    });
    alertSpy.mockRestore();
  });

  it("desabilita e reabilita o botão durante o submit", async () => {
    const { form, nomeEl, emailEl, submitBtn } = createFormElements();
    initRegistry(document);

    nomeEl.value = "Btn";
    emailEl.value = "btn@b.com";
    let resolveFetch;
    fetchMock.mockImplementation(
      () =>
        new Promise((r) => {
          resolveFetch = r;
        }),
    );

    form.requestSubmit();

    expect(submitBtn.disabled).toBe(true);
    expect(submitBtn.dataset.loading).toBe("true");

    resolveFetch({ ok: true, json: () => Promise.resolve({ ok: true }) });
    await vi.waitFor(() => {
      expect(submitBtn.disabled).toBe(false);
      expect(submitBtn.dataset.loading).toBe("false");
    });
  });

  it("checkValidity/reportValidity quando formulário inválido", () => {
    const { form, nomeEl, emailEl } = createFormElements();
    form.querySelector("#email").setAttribute("required", "");
    initRegistry(document);

    nomeEl.value = "A";
    emailEl.value = "";
    const reportSpy = vi.spyOn(form, "reportValidity").mockImplementation(() => true);
    const validitySpy = vi.spyOn(form, "checkValidity").mockReturnValue(false);

    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    expect(validitySpy).toHaveBeenCalled();
    expect(reportSpy).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
