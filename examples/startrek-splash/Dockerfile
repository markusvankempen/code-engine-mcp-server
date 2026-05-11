FROM nginx:alpine

# Copy the Star Trek splash application to the Nginx HTML directory
COPY index.html /usr/share/nginx/html/index.html

# Code Engine requires port 8080.
# Use [[:space:]]* to match any whitespace — nginx:alpine's default.conf uses
# variable spacing that exact-string patterns will miss.
RUN sed -i 's/listen[[:space:]]*80;/listen 8080;/g' /etc/nginx/conf.d/default.conf \
 && sed -i 's/listen[[:space:]]*\[::\]:80;/listen [::]:8080;/g' /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]