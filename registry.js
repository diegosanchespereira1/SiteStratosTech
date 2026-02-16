(() => {
  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  const form = $(".notify-form");
  if (!form) return;

  const nomeEl = $("#nome", form);
  const emailEl = $("#email", form);
  const submitBtn = $(".submit-btn", form) ?? $("button[type='submit']", form);
  const statusEl = $(".form-status", form);

  const modal = $("#registry-modal");
  const modalMsg = $("#registry-modal-message");
  const modalClose = $("#registry-modal-close");

  let lastFocused = null;

  function setStatus(message, kind = "info") {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.dataset.kind = kind;
  }

  function openModal(message) {
    if (!modal || !modalMsg || !modalClose) {
      // Fallback simples caso o markup do modal nao exista.
      alert(message);
      return;
    }
    lastFocused = document.activeElement;
    modalMsg.textContent = message;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    modalClose.focus();
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  }

  modal?.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches("[data-modal-backdrop]")) closeModal();
  });

  modalClose?.addEventListener("click", closeModal);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!modal || modal.hidden) return;
    closeModal();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (typeof form.checkValidity === "function" && !form.checkValidity()) {
      if (typeof form.reportValidity === "function") form.reportValidity();
      return;
    }

    const nome = (nomeEl?.value ?? "").trim();
    const email = (emailEl?.value ?? "").trim();
    if (!nome || !email) {
      setStatus("Preencha nome e e-mail.", "error");
      return;
    }

    setStatus("", "info");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.dataset.loading = "true";
    }

    try {
      const resp = await fetch("/api/registry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nome, email }),
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data || data.ok !== true) {
        throw new Error(data?.error || "Nao foi possivel registrar agora.");
      }

      const message = data.alreadyRegistered
        ? `Obrigado, ${nome}! Seu e-mail ja esta cadastrado.`
        : `Obrigado, ${nome}! Cadastro confirmado com sucesso.`;

      form.reset();
      openModal(message);
    } catch (err) {
      setStatus(err?.message || "Erro ao enviar. Tente novamente.", "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.dataset.loading = "false";
      }
    }
  });
})();

