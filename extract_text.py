import os
from bs4 import BeautifulSoup

input_folder = "htm_chapters"
output_file = "dear_canada_clean.txt"

all_text = []

for filename in sorted(os.listdir(input_folder)):
    if filename.endswith(".htm"):			# can be htm or html, just change this line
        path = os.path.join(input_folder, filename)

        with open(path, "r", encoding="utf-8") as f:
            soup = BeautifulSoup(f, "lxml")

            # remove junk
            for tag in soup(["script", "style"]):
                tag.decompose()

            text = soup.get_text(separator="\n")
            all_text.append(f"\n\n===== {filename} =====\n\n")
            all_text.append(text)

with open(output_file, "w", encoding="utf-8") as out:
    out.write("\n".join(all_text))

print("Done! Check dear_canada_clean.txt")