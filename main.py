from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import pytesseract
from PIL import Image
import io
import re

app = FastAPI()

# Allow the frontend to communicate with this backend
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
        # Read the uploaded image
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        
        # Run Tesseract OCR (much faster on a backend CPU)
        text = pytesseract.image_to_string(image)
        
        # Heuristic to find grades and units
        words = text.split()
        extracted_data = []
        
        for i in range(len(words)):
            # Look for patterns that match grades (e.g., 1.25, 2.50, 3.0)
            if re.match(r'^[1-3]\.\d{1,2}$|^5\.00?$', words[i]):
                try:
                    val = float(words[i])
                    snapped = snap_to_valid_grade(val)
                    
                    # Assume a default of 3 units, but scan nearby text for a 1-6 unit number
                    units = 3 
                    neighborhood = words[max(0, i-3):min(len(words), i+4)]
                    for w in neighborhood:
                        if re.match(r'^[1-6]$', w):
                            units = int(w)
                            break
                    
                    extracted_data.append({"grade": snapped, "units": units})
                except ValueError:
                    continue
                    
        return {"status": "success", "data": extracted_data}
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})