#!/bin/bash

# Thanks ChatGPT!

# Check if a file path is provided
if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <path_to_txt_file>"
  exit 1
fi

file_path="$1"

# Check if the file exists
if [ ! -f "$file_path" ]; then
  echo "File not found: $file_path"
  exit 1
fi

while IFS= read -r line; do
  w=$line

  # Extract the last two characters of the line
  lasttwo="${w: -2}"

  # Check if the last two characters are digits
  if [[ $lasttwo =~ ^[0-9]{2}$ ]]; then
    archivenum=$lasttwo
  else
    archivenum=0
  fi

  # Convert archivenum to an integer and divide it by 25, taking the integer part of the result
  archivenum=$((10#$archivenum / 25))

  # Initialize source_dir with "sources" and then check for alternative directories if it doesn't exist
  base_dir="/mnt/Archive${archivenum}/${lasttwo}/${w}/"
  dir_suffixes=("sources" "archive" "images")
  source_dir=""
  for suffix in "${dir_suffixes[@]}"; do
    if [ -d "${base_dir}${suffix}/" ]; then
      source_dir="${base_dir}${suffix}/"
      break
    fi
  done

  if [ -z "$source_dir" ]; then
    echo "No valid directory found for $w. Skipping..."
    continue
  fi

  # Output the absolute paths of the direct subdirectories of the source directory
  find "$source_dir" -maxdepth 1 -type d ! -path "$source_dir" | while read subdir; do
    # Extract the last part of the path as the subdirectory name
    subdir_name=$(basename "$subdir")
    # Construct and print the formatted output
    echo "recrop/${w}/${suffix}/${subdir_name}/"
  done

  # Execute the AWS S3 copy command
  #echo aws s3 cp --recursive "$source_dir" "s3://image-processing.bdrc.io/recrop/${w}/${suffix}/"
  aws s3 --profile image_processing cp --recursive "$source_dir" "s3://image-processing.bdrc.io/recrop/${w}/${suffix}/"

done < "$file_path"
