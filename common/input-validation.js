/* 数値入力の範囲外・刻み違反を全シミュレーターで共通表示する。 */
(function (global) {
  "use strict";

  var FIELD_SELECTOR = 'input[type="number"], input[type="range"]';
  var ALERT_ID = "commonInputValidationAlert";

  function isActive(el) {
    return !el.disabled && !el.closest("[hidden]") && el.offsetParent !== null;
  }

  function labelText(el) {
    if (el.dataset.validationLabel) return el.dataset.validationLabel;
    var label = null;
    if (el.id) {
      var labels = document.querySelectorAll("label[for]");
      for (var i = 0; i < labels.length; i++) {
        if (labels[i].getAttribute("for") === el.id) {
          label = labels[i];
          break;
        }
      }
    }
    if (!label) label = el.closest("label");
    if (!label) return el.getAttribute("aria-label") || el.id || "入力値";

    var copy = label.cloneNode(true);
    copy
      .querySelectorAll("input, select, .unit, .help, .tipbox, .field-note")
      .forEach(function (node) {
        node.remove();
      });
    return copy.textContent.replace(/\s+/g, " ").trim() || el.id || "入力値";
  }

  function errorFor(el) {
    if (!isActive(el)) return null;
    var name = labelText(el);
    if (el.validity.badInput)
      return { el: el, text: name + "は数値で入力してください。" };
    if (el.value === "") {
      if (el.required) return { el: el, text: name + "を入力してください。" };
      return null;
    }
    if (el.validity.rangeUnderflow || el.validity.rangeOverflow) {
      var min = el.getAttribute("min"),
        max = el.getAttribute("max"),
        range =
          min !== null && max !== null
            ? min + "～" + max + "の範囲"
            : min !== null
              ? min + "以上"
              : max + "以下";
      return {
        el: el,
        text: name + "は" + range + "で入力してください。",
      };
    }
    if (el.validity.stepMismatch && el.getAttribute("step") === "1") {
      return {
        el: el,
        text: name + "は整数で入力してください。",
      };
    }
    return null;
  }

  function ensureAlert() {
    var alert = document.getElementById(ALERT_ID);
    if (alert) return alert;
    var first = document.querySelector("main " + FIELD_SELECTOR);
    if (!first) return null;

    alert = document.createElement("div");
    alert.id = ALERT_ID;
    alert.className = "common-input-validation-alert";
    alert.setAttribute("role", "alert");
    alert.hidden = true;

    var container =
      first.closest(".card, .panel, aside, section, form") ||
      first.parentElement;
    var heading = container && container.querySelector("h1, h2, h3");
    if (heading) heading.insertAdjacentElement("afterend", alert);
    else if (container) container.insertBefore(alert, container.firstChild);
    return alert;
  }

  function refresh() {
    var alert = ensureAlert();
    if (!alert) return [];
    document
      .querySelectorAll(FIELD_SELECTOR + '[aria-invalid="true"]')
      .forEach(function (el) {
        if (el.getAttribute("aria-errormessage") === ALERT_ID) {
          el.removeAttribute("aria-invalid");
          el.removeAttribute("aria-errormessage");
        }
      });

    var errors = [];
    document.querySelectorAll(FIELD_SELECTOR).forEach(function (el) {
      var error = errorFor(el);
      if (error) errors.push(error);
    });
    errors.forEach(function (error) {
      error.el.setAttribute("aria-invalid", "true");
      error.el.setAttribute("aria-errormessage", ALERT_ID);
    });

    alert.replaceChildren();
    if (errors.length) {
      var strong = document.createElement("strong"),
        list = document.createElement("ul");
      strong.textContent = "入力内容を確認してください。";
      errors.forEach(function (error) {
        var item = document.createElement("li");
        item.textContent = error.text;
        list.appendChild(item);
      });
      alert.append(strong, list);
    }
    alert.hidden = errors.length === 0;
    return errors;
  }

  function handleInput(event) {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (!event.target.matches(FIELD_SELECTOR)) return;
    if (refresh().length) event.stopImmediatePropagation();
  }

  function init() {
    if (!document.querySelector(FIELD_SELECTOR)) return;
    ensureAlert();
    refresh();
    document.addEventListener("input", handleInput, true);
    document.addEventListener("change", handleInput, true);
    document.addEventListener("click", function () {
      global.setTimeout(refresh, 0);
    });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();

  global.CommonInputValidation = { refresh: refresh };
})(window);
