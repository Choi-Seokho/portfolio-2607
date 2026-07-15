(function () {
  var btn = document.getElementById("backToTop");
  if (!btn) return;

  var THRESHOLD = 400;

  function toggle() {
    btn.classList.toggle("visible", window.scrollY > THRESHOLD);
  }

  window.addEventListener("scroll", toggle, { passive: true });
  toggle();

  btn.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();
