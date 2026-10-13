# 🎓 Fast GWA Calculator with OCR Grade Reader

A web app that works out your **General Weighted Average (GWA)** from a screenshot of your grades. Upload the picture, check the table it fills in, press **Calculate**, and see your honors standing.

Everything runs in your browser. There is no server and no account, and your picture is never uploaded anywhere.

---

## ✨ Features

- 📸 **Reads your screenshot:** OCR finds the course codes, grades and units and fills in a table for you.
- ✏️ **Editable table:** Fix, add or remove rows before you calculate. A box with an amber border is a number the reader wasn't sure about, so compare it with your picture.
- 🧮 **You press Calculate:** Nothing is worked out until you press **Calculate My GWA**. If you change the table afterwards, the old result is hidden until you press the button again.
- 🏆 **Honors standing:** Your GWA is matched to these brackets:
  - **1.00 - 1.50:** University Scholar (US)
  - **1.51 - 1.75:** College Scholar (CS)
  - **1.76 - 2.00:** Dean's Lister (DL)
- 🎉 **Confetti:** Get University Scholar or College Scholar and a congratulations popup shows up with confetti.
- 🔒 **Private:** The reader runs on your own device. Your screenshot stays with you.

---

## 🧮 How the GWA is counted

- GWA = total of (grade × units) ÷ total units.
- Subjects marked INC, dropped, withdrawn, no grade yet or not credited are left out, and so are subjects with units in brackets, like `[3]`. The page tells you what it left out.
- A failing grade of 5.00 counts like any other grade.
- The GWA is rounded to 2 decimals before it is matched to a bracket. If rounding is what puts you in a bracket, the result says so, because some schools don't round.
- The grade choices are 1.00 to 3.00 in steps of 0.25, and 5.00.

**Tip:** Use a full-size, straight screenshot where the course codes, units and grades are all visible. Very small or heavily tilted pictures are the most likely to be misread, so check the amber boxes.

---

## 🛠️ Tech Stack

- **Page:** HTML, plain JavaScript, Tailwind CSS (from a CDN)
- **Reading the picture:** [Tesseract.js](https://github.com/naptha/tesseract.js) running in a web worker (WebAssembly), with the reader and its English data included in `vendor/`
- **Hosting:** static files, served from GitHub Pages

---

## 🚀 Run it on your computer

You only need a way to serve the files. Python works fine for that:

```bash
git clone https://github.com/RenP1e/GWA_Calculator.git
cd GWA_Calculator
python -m http.server 8000
```

Then open <http://localhost:8000> in your browser. Any static file server works too, for example `npx serve`.

- Open it through a server like this, not by double-clicking `index.html`. The reader loads its files with `fetch` and a web worker, which browsers usually block on `file://` pages.
- The page loads Tailwind CSS from a CDN, so you need an internet connection for the styling.
- The first scan has to load about 8 MB of reader files from the site, so it is slower than the ones after it.
