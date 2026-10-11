from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import pytesseract
from PIL import Image, ImageOps, ImageEnhance
import io
import re

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

VALID_GRADES = [1.00, 1.25, 1.50, 1.75, 2.00, 2.25, 2.50, 2.75, 3.00, 5.00]

def snap_to_valid_grade(num):
    return min(VALID_GRADES, key=lambda x: abs(x - num))

@app.post("/extract-grades")
async def extract_grades(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        
        image = image.convert('L')
        image = ImageOps.autocontrast(image)
        image = ImageEnhance.Sharpness(image).enhance(2.0)
        
        text = pytesseract.image_to_string(image, config=r'--oem 3 --psm 6')
        
        print("--- RAW TESSERACT OUTPUT START ---")
        print(text)
        print("--- RAW TESSERACT OUTPUT END ---")
        
        extracted_data = []
        
        tokens = re.findall(r'\b(?:[1-3]\.\d{1,2}|5\.00?|1[0257]0?|2[0257]0?|300?|500)\b', text)
        
        for token in tokens:
            try:
                val = float(token)
                if val > 10:
                    val = val / 100.0
                
                snapped = snap_to_valid_grade(val)
                extracted_data.append({"grade": snapped, "units": 3})
            except ValueError:
                continue
                    
        return {"status": "success", "data": extracted_data, "raw_text": text}
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})