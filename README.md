# 🎓 Fast GWA Calculator with OCR Grade Reader

A web-based **General Weighted Average (GWA)** calculator designed for college students. Instead of manually typing every grade, users can upload a screenshot of their student portal, and the built-in OCR reader automatically extracts their grades and course units to compute their GWA instantly.

---

## ✨ Features

- 📸 **Automatic Screenshot Parsing:** Uses Optical Character Recognition (OCR) to detect grades and units from uploaded images.
- ✏️ **Manual Verification Editor:** Auto-populates a dynamic table where students can quickly adjust, add, or remove grades before calculating.
- 🏆 **Scholarship Classification:** Instantly classifies student standing according to honor brackets:
  - **1.00 - 1.50:** University Scholar (US)
  - **1.51 - 1.75:** College Scholar (CS)
  - **1.76 - 2.00:** Dean's Lister (DL)
- 🚀 **Decoupled Architecture:** Clean client-server separation with a lightweight static frontend and an asynchronous Python backend.

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, JavaScript (ES6+), Tailwind CSS
- **Backend:** Python 3.11, FastAPI, Uvicorn
- **OCR Engine:** PyTesseract (Tesseract OCR), Pillow (PIL)
- **Deployment:** GitHub Pages (Frontend) & Render / Docker (Backend)

---

## 🚀 Local Setup Instructions

### Prerequisites
1. Install [Python 3.10+](https://www.python.org/downloads/).
2. Install [Tesseract OCR Engine](https://github.com/UB-Mannheim/tesseract/wiki) on your machine.

### Backend Setup
1. Clone the repository:
   ```bash
