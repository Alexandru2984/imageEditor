// Applies the saved or system colour scheme before first paint. Kept as an
// external file because the Content-Security-Policy forbids inline scripts.
(function () {
  var dark = true;
  try {
    var saved = window.localStorage.getItem("ie-theme");
    dark =
      saved === "dark" ||
      (saved !== "light" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
  } catch (error) {
    dark = true;
  }
  var root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
})();
