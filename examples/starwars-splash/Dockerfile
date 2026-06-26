FROM nginx:alpine

# The splash page is fully self-contained in index.html, including styling,
# animation, starfield rendering, and the synthesized theme toggle.
COPY ./index.html /usr/share/nginx/html/index.html

# Code Engine requires port 8080.
# Use [[:space:]]* to match any whitespace — nginx:alpine's default.conf uses
# variable spacing that exact-string patterns will miss.
RUN sed -i 's/listen[[:space:]]*80;/listen 8080;/g' /etc/nginx/conf.d/default.conf \
 && sed -i 's/listen[[:space:]]*\[::\]:80;/listen [::]:8080;/g' /etc/nginx/conf.d/default.conf

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
	CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
